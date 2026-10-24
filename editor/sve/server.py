"""The editor's local web server. Only reachable from this computer, and every request must carry
the random key the window was opened with, so other web pages cannot talk to it."""

from __future__ import annotations

import hashlib
import json
import logging
import mimetypes
import re
import secrets
import shutil
import sys
import threading
import time
import urllib.parse
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import images
from .config import Config
from .store import DATA_FILES, ConflictError, GitHubStore, LocalStore, StoreError, dump_json

log = logging.getLogger('sve')

# Product and gallery files, and the photo folder new photos for each go into.
PHOTO_FOLDERS = {
    'src/data/ceramic.json': 'Ceramic',
    'src/data/luster.json': 'Luster',
    'src/data/gold.json': 'Gold',
    'src/data/inglaze.json': 'InGlaze',
    'src/data/gallery.json': 'gallery',
}
PRODUCT_FILES = [p for p in PHOTO_FOLDERS if p != 'src/data/gallery.json']
STOCK = {'in', 'low', 'out'}
GALLERY_CATEGORIES = {'gold', 'lustre', 'glass', 'ceramic', 'packing'}
HEX = re.compile(r'^#[0-9A-Fa-f]{6}$')


def ui_dir() -> Path:
    base = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent.parent))
    return base / 'ui'


def slug(text: str) -> str:
    s = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    return s[:40] or 'photo'


def validate(path: str, content) -> None:
    """Refuse anything that would break the website build. Messages are for the person using the editor."""
    if path in PRODUCT_FILES:
        if not isinstance(content, list):
            raise StoreError('Something went wrong with the colour list. Press "Get latest" and try again.')
        for i, item in enumerate(content, 1):
            name = (item.get('name') or '').strip()
            if not name:
                raise StoreError(f'Colour number {i} has no name.')
            if item.get('stock') not in STOCK:
                raise StoreError(f'"{name}" has no stock status.')
            if not HEX.match(item.get('hex') or ''):
                raise StoreError(f'"{name}" has no swatch colour.')
            if not isinstance(item.get('range'), str) or not item['range']:
                raise StoreError(f'"{name}" has no type.')
            img = item.get('image')
            if img is not None and (not isinstance(img, str) or not img):
                raise StoreError(f'"{name}" has a broken photo. Choose the photo again.')
            if path == 'src/data/gold.json' and not (item.get('purity') or '').strip():
                raise StoreError(f'"{name}" has no purity.')
            if path in ('src/data/ceramic.json', 'src/data/inglaze.json') and not (item.get('code') or '').strip():
                raise StoreError(f'"{name}" has no code.')
    elif path == 'src/data/gallery.json':
        if not isinstance(content, list):
            raise StoreError('Something went wrong with the gallery. Press "Get latest" and try again.')
        for i, item in enumerate(content, 1):
            if not item.get('image'):
                raise StoreError(f'Gallery photo {i} has no photo.')
            if not (item.get('caption') or '').strip():
                raise StoreError(f'Gallery photo {i} has no caption.')
            if item.get('category') not in GALLERY_CATEGORIES:
                raise StoreError(f'Gallery photo "{item.get("caption")}" has no category.')
    elif path == 'src/data/site.json':
        needed = ['name', 'phones', 'whatsapp', 'emails', 'hours', 'address']
        if not isinstance(content, dict) or any(k not in content for k in needed):
            raise StoreError('Contact details are incomplete. Press "Get latest" and try again.')
        if not re.fullmatch(r'\d{10,15}', str(content['whatsapp'])):
            raise StoreError('The WhatsApp number should be digits only, with the country code (for example 919897135970).')
        for p in content['phones']:
            if not (p.get('display') or '').strip() or not re.fullmatch(r'\+\d{10,15}', p.get('tel') or ''):
                raise StoreError('Each phone number needs digits with the country code (for example +91 98971 35970).')
    elif path == 'src/data/ranges.json':
        for key in ('gold', 'luster', 'ceramic', 'inglaze'):
            r = content.get(key) if isinstance(content, dict) else None
            if not r or not (r.get('title') or '').strip():
                raise StoreError('A product range lost its title. Press "Get latest" and try again.')
            if not isinstance(r.get('min'), int) or not isinstance(r.get('max'), int) or r['min'] >= r['max']:
                raise StoreError(f'"{r.get("title")}": the lowest firing temperature must be below the highest.')
    else:
        raise StoreError('The editor tried to change a file it is not allowed to change.')


class Editor:
    """Everything the web page can ask for. One instance per running app."""

    def __init__(self, config: Config, local_root: str | None = None, api: str | None = None):
        self.config = config
        self.local_root = local_root
        self.api = api
        self.draft_dir = config.dir / 'draft'
        self.photo_dir = self.draft_dir / 'photos'
        self.cache_dir = config.dir / 'cache'
        self.photo_dir.mkdir(parents=True, exist_ok=True)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.last_heartbeat = time.time()

    # -- Store ----------------------------------------------------------------

    def store(self):
        if self.local_root:
            return LocalStore(self.local_root)
        token = self.config.token()
        if not token:
            raise StoreError('The editor is not set up yet.')
        s = self.config.settings()
        return GitHubStore(token, s['repo'], s['branch'], **({'api': self.api} if self.api else {}))

    def state(self) -> dict:
        s = self.config.settings()
        return {
            'configured': bool(self.local_root or self.config.token()),
            'local': bool(self.local_root),
            'settings': s,
            'windows': sys.platform == 'win32',
            'draft': (self.draft_dir / 'draft.json').exists(),
        }

    def setup(self, body: dict) -> dict:
        token = (body.get('token') or '').strip() or self.config.token() or ''
        repo = (body.get('repo') or '').strip()
        branch = (body.get('branch') or '').strip()
        site_url = (body.get('site_url') or '').strip().rstrip('/')
        if not token:
            raise StoreError('Paste the GitHub key first.')
        if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo):
            raise StoreError('The repository should look like owner/name.')
        if not branch:
            raise StoreError('Enter the branch name (usually main).')
        if not re.match(r'https?://', site_url):
            raise StoreError('The website address should start with https://')
        GitHubStore(token, repo, branch, **({'api': self.api} if self.api else {})).check()
        self.config.save_token(token)
        self.config.save_settings({'repo': repo, 'branch': branch, 'site_url': site_url})
        return self.state()

    def forget(self) -> dict:
        self.config.forget_token()
        return self.state()

    # -- Data -------------------------------------------------------------------

    def load(self) -> dict:
        store = self.store()
        files = {}
        for path in DATA_FILES:
            try:
                content, sha = store.read_json(path)
            except FileNotFoundError:
                content, sha = ([] if path != 'src/data/site.json' and path != 'src/data/ranges.json' else {}), None
            files[path] = {'content': content, 'sha': sha}
        return {'files': files, 'draft': self.read_draft()}

    def read_draft(self):
        try:
            return json.loads((self.draft_dir / 'draft.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            return None

    def save_draft(self, body) -> dict:
        self.draft_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.draft_dir / 'draft.json.tmp'
        tmp.write_text(json.dumps(body, ensure_ascii=False), encoding='utf-8')
        tmp.replace(self.draft_dir / 'draft.json')
        return {'ok': True}

    def clear_draft(self) -> dict:
        try:
            (self.draft_dir / 'draft.json').unlink()
        except OSError:
            pass
        shutil.rmtree(self.photo_dir, ignore_errors=True)
        self.photo_dir.mkdir(parents=True, exist_ok=True)
        return {'ok': True}

    # -- Photos -----------------------------------------------------------------

    def add_photo(self, data: bytes) -> dict:
        prepared = images.prepare(data)
        pid = uuid.uuid4().hex
        self.photo_dir.mkdir(parents=True, exist_ok=True)
        (self.photo_dir / f'{pid}.jpg').write_bytes(prepared['jpeg'])
        return {'id': pid, 'hex': prepared['hex'], 'width': prepared['width'], 'height': prepared['height']}

    def draft_photo(self, pid: str) -> bytes:
        if not re.fullmatch(r'[0-9a-f]{32}', pid):
            raise FileNotFoundError(pid)
        return (self.photo_dir / f'{pid}.jpg').read_bytes()

    def site_photo(self, path: str) -> bytes:
        if not re.fullmatch(r'resources/[\w ()./-]+\.(jpe?g|png|webp)', path, re.I) or '..' in path:
            raise FileNotFoundError(path)
        cached = self.cache_dir / (hashlib.sha1(path.encode()).hexdigest() + '.jpg')
        if cached.exists():
            return cached.read_bytes()
        thumb = images.thumbnail(self.store().read_bytes('src/assets/' + path))
        cached.write_bytes(thumb)
        return thumb

    # -- Publishing -------------------------------------------------------------

    def publish(self, body: dict) -> dict:
        files: dict = body.get('files') or {}
        base: dict = body.get('baseShas') or {}
        message = (body.get('message') or 'Website update').strip()[:2000]
        if not files:
            raise StoreError('There is nothing to publish.')
        out: dict[str, bytes] = {}
        for path, content in files.items():
            if path not in DATA_FILES:
                raise StoreError('The editor tried to change a file it is not allowed to change.')
            if path in PHOTO_FOLDERS:
                for item in content:
                    img = item.get('image')
                    if isinstance(img, str) and img.startswith('draft:'):
                        pid = img[len('draft:'):]
                        label = item.get('code') or item.get('purity') or ''
                        name = slug(f"{label} {item.get('name') or item.get('caption') or ''}") + f'-{pid[:6]}.jpg'
                        rel = f'resources/{PHOTO_FOLDERS[path]}/{name}'
                        out['src/assets/' + rel] = self.draft_photo(pid)
                        item['image'] = rel
            validate(path, content)
            out[path] = dump_json(content)
        result = self.store().commit(out, message, {p: base[p] for p in files if base.get(p)})
        self.clear_draft()
        log.info('published %s: %s', result.get('sha'), message.splitlines()[0])
        return result

    def deploy_status(self, sha: str) -> dict:
        return {'status': self.store().deploy_status(sha)}

    # -- Desktop ----------------------------------------------------------------

    def desktop_shortcut(self) -> dict:
        if sys.platform != 'win32' or not getattr(sys, 'frozen', False):
            raise StoreError('Desktop icons can only be made by the Windows app.')
        import subprocess

        exe = sys.executable.replace("'", "''")
        script = (
            "$d=[Environment]::GetFolderPath('Desktop');"
            "$s=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $d 'SVE Website Editor.lnk'));"
            f"$s.TargetPath='{exe}';$s.IconLocation='{exe},0';$s.Description='Edit the Shri Vijay Enterprises website';$s.Save()"
        )
        subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-Command', script], check=True, creationflags=0x08000000)
        return {'ok': True}

    def open_url(self, url: str) -> dict:
        allowed = (self.config.settings()['site_url'], 'https://github.com/')
        if not any(url.startswith(a) for a in allowed):
            raise StoreError('That link is not allowed.')
        webbrowser.open(url)
        return {'ok': True}


def make_handler(editor: Editor, key: str):
    ui = ui_dir()

    class Handler(BaseHTTPRequestHandler):
        server_version = 'SVEEditor/1'

        def log_message(self, fmt, *args):
            log.debug('%s %s', self.address_string(), fmt % args)

        # -- helpers --
        def _send(self, code: int, body: bytes, ctype: str, cache: bool = False):
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'private, max-age=86400' if cache else 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code: int, obj):
            self._send(code, json.dumps(obj, ensure_ascii=False).encode('utf-8'), 'application/json; charset=utf-8')

        def _authorised(self, query: dict) -> bool:
            given = self.headers.get('X-SVE-Key') or (query.get('k') or [''])[0]
            return secrets.compare_digest(given, key)

        def _body(self) -> bytes:
            length = int(self.headers.get('Content-Length') or 0)
            return self.rfile.read(length) if length else b''

        def _run(self, fn, *args):
            try:
                self._json(200, fn(*args))
            except ConflictError as e:
                self._json(409, {'error': str(e), 'conflict': e.paths})
            except (StoreError, images.PhotoError) as e:
                self._json(400, {'error': str(e)})
            except FileNotFoundError:
                self._json(404, {'error': 'Not found.'})
            except Exception:
                log.exception('request failed')
                self._json(500, {'error': 'Something went wrong inside the editor. Close it and open it again.'})

        # -- routes --
        def do_GET(self):
            url = urllib.parse.urlparse(self.path)
            q = urllib.parse.parse_qs(url.query)
            if url.path == '/':
                return self._send(200, (ui / 'index.html').read_bytes(), 'text/html; charset=utf-8')
            if url.path.startswith('/ui/'):
                target = (ui / url.path[4:]).resolve()
                if ui.resolve() not in target.parents or not target.is_file():
                    return self._send(404, b'', 'text/plain')
                ctype = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
                if target.suffix == '.woff2':
                    ctype = 'font/woff2'
                return self._send(200, target.read_bytes(), ctype, cache=target.suffix == '.woff2')
            if not self._authorised(q):
                return self._json(403, {'error': 'Not allowed.'})
            if url.path == '/api/state':
                return self._run(editor.state)
            if url.path.startswith('/photo/draft/'):
                try:
                    return self._send(200, editor.draft_photo(url.path.rsplit('/', 1)[1]), 'image/jpeg')
                except (FileNotFoundError, OSError):
                    return self._send(404, b'', 'text/plain')
            if url.path == '/photo/site':
                try:
                    return self._send(200, editor.site_photo((q.get('path') or [''])[0]), 'image/jpeg', cache=True)
                except Exception:
                    return self._send(404, b'', 'text/plain')
            if url.path == '/api/deploy':
                return self._run(editor.deploy_status, (q.get('sha') or [''])[0])
            return self._json(404, {'error': 'Not found.'})

        def do_POST(self):
            url = urllib.parse.urlparse(self.path)
            q = urllib.parse.parse_qs(url.query)
            if not self._authorised(q):
                return self._json(403, {'error': 'Not allowed.'})
            raw = self._body()
            if url.path == '/api/photo':
                return self._run(editor.add_photo, raw)
            try:
                body = json.loads(raw or b'{}')
            except ValueError:
                return self._json(400, {'error': 'Bad request.'})
            routes = {
                '/api/setup': lambda: editor.setup(body),
                '/api/forget': editor.forget,
                '/api/load': editor.load,
                '/api/draft': lambda: editor.save_draft(body),
                '/api/discard': editor.clear_draft,
                '/api/publish': lambda: editor.publish(body),
                '/api/shortcut': editor.desktop_shortcut,
                '/api/open': lambda: editor.open_url(body.get('url', '')),
                '/api/heartbeat': lambda: (setattr(editor, 'last_heartbeat', time.time()), {'ok': True})[1],
            }
            if url.path in routes:
                return self._run(routes[url.path])
            return self._json(404, {'error': 'Not found.'})

    return Handler


def serve(editor: Editor, port: int = 0) -> tuple[ThreadingHTTPServer, str]:
    key = secrets.token_urlsafe(24)
    httpd = ThreadingHTTPServer(('127.0.0.1', port), make_handler(editor, key))
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{httpd.server_address[1]}/?k={key}'
    return httpd, url
