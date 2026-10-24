"""Where the website's files live: on GitHub (normal use) or in a local folder (testing).

Both stores offer the same small interface:
  read_json(path) -> (data, sha)      read a data file
  read_bytes(path) -> bytes           read any file (photos)
  file_sha(path) -> sha or None       current version of a file, to detect someone else's changes
  commit(files, message, base_shas)   save several files in one go
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# Every data file the editor reads or writes, relative to the repository root.
DATA_FILES = [
    'src/data/ceramic.json',
    'src/data/luster.json',
    'src/data/gold.json',
    'src/data/inglaze.json',
    'src/data/gallery.json',
    'src/data/site.json',
    'src/data/ranges.json',
]


class StoreError(Exception):
    """A problem worth showing to the person using the editor, in plain words."""


class ConflictError(StoreError):
    def __init__(self, paths: list[str]):
        self.paths = paths
        super().__init__(
            'The website was changed from somewhere else after you opened the editor. '
            'Press "Get latest" and make your changes again.'
        )


def git_blob_sha(data: bytes) -> str:
    """The id GitHub gives a file's contents. Lets the local store detect changes the same way."""
    return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()


def dump_json(data) -> bytes:
    """Write data files the same way every time: 2-space indent, real Unicode, newline at the end."""
    return (json.dumps(data, indent=2, ensure_ascii=False) + '\n').encode('utf-8')


class GitHubStore:
    def __init__(self, token: str, repo: str, branch: str, api: str = 'https://api.github.com'):
        self.token = token.strip()
        self.repo = repo.strip().strip('/')
        self.branch = branch.strip()
        self.api = api.rstrip('/')

    # -- HTTP -----------------------------------------------------------------

    def _request(self, method: str, path: str, body=None, accept: str = 'application/vnd.github+json', raw: bool = False):
        data = json.dumps(body).encode('utf-8') if body is not None else None
        req = urllib.request.Request(
            self.api + path,
            data=data,
            method=method,
            headers={
                'Authorization': f'Bearer {self.token}',
                'Accept': accept,
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'SVE-Website-Editor',
                **({'Content-Type': 'application/json'} if data else {}),
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = resp.read()
        except urllib.error.HTTPError as e:
            detail = ''
            try:
                detail = json.loads(e.read() or b'{}').get('message', '')
            except Exception:
                pass
            if e.code == 401:
                raise StoreError('GitHub did not accept the key. If this keeps happening, ask Kartik to set the editor up again.') from e
            if e.code == 403 and 'rate limit' in detail.lower():
                raise StoreError('GitHub is busy right now. Wait a few minutes and try again.') from e
            if e.code in (403, 404) and method != 'GET':
                raise StoreError('The GitHub key is not allowed to change the website. Ask Kartik to check its permissions.') from e
            if e.code == 404:
                raise FileNotFoundError(path) from e
            if e.code == 409 or e.code == 422:
                raise ConflictError([]) from e
            raise StoreError(f'GitHub said: {detail or e.reason} ({e.code}). Try again in a minute.') from e
        except urllib.error.URLError as e:
            raise StoreError('Could not reach GitHub. Check the internet connection and try again.') from e
        if raw:
            return payload
        return json.loads(payload) if payload else None

    def _repo_path(self, suffix: str) -> str:
        return f'/repos/{self.repo}{suffix}'

    def _contents(self, path: str) -> str:
        return self._repo_path('/contents/' + urllib.parse.quote(path) + '?ref=' + urllib.parse.quote(self.branch))

    # -- Reading ----------------------------------------------------------------

    def check(self) -> None:
        """Make sure the key works, can write, and the branch has the website's data files."""
        try:
            info = self._request('GET', self._repo_path(''))
        except FileNotFoundError:
            raise StoreError(f'Repository "{self.repo}" not found, or the key cannot see it.')
        perms = info.get('permissions') or {}
        if perms and not perms.get('push'):
            raise StoreError('This key can read the website but not change it. Give it "Contents: Read and write".')
        try:
            self._request('GET', self._repo_path('/branches/' + urllib.parse.quote(self.branch)))
        except FileNotFoundError:
            raise StoreError(f'Branch "{self.branch}" not found in {self.repo}.')
        try:
            self.read_json('src/data/ceramic.json')
        except FileNotFoundError:
            raise StoreError(f'Branch "{self.branch}" does not have the new website yet (src/data/ceramic.json is missing).')

    def read_json(self, path: str):
        meta = self._request('GET', self._contents(path))
        data = base64.b64decode(meta['content'])
        return json.loads(data.decode('utf-8')), meta['sha']

    def read_bytes(self, path: str) -> bytes:
        return self._request('GET', self._contents(path), accept='application/vnd.github.raw', raw=True)

    def file_sha(self, path: str) -> str | None:
        try:
            return self._request('GET', self._contents(path))['sha']
        except FileNotFoundError:
            return None

    # -- Writing ----------------------------------------------------------------

    def commit(self, files: dict[str, bytes], message: str, base_shas: dict[str, str]) -> dict:
        changed = [p for p, sha in base_shas.items() if self.file_sha(p) != sha]
        if changed:
            raise ConflictError(changed)
        ref_path = self._repo_path('/git/ref/heads/' + urllib.parse.quote(self.branch))
        head = self._request('GET', ref_path)['object']['sha']
        base_tree = self._request('GET', self._repo_path(f'/git/commits/{head}'))['tree']['sha']
        tree = []
        for path, data in files.items():
            blob = self._request('POST', self._repo_path('/git/blobs'), {'content': base64.b64encode(data).decode('ascii'), 'encoding': 'base64'})
            tree.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': blob['sha']})
        new_tree = self._request('POST', self._repo_path('/git/trees'), {'base_tree': base_tree, 'tree': tree})
        new_commit = self._request('POST', self._repo_path('/git/commits'), {'message': message, 'tree': new_tree['sha'], 'parents': [head]})
        self._request('PATCH', self._repo_path('/git/refs/heads/' + urllib.parse.quote(self.branch)), {'sha': new_commit['sha'], 'force': False})
        return {'sha': new_commit['sha'], 'url': new_commit.get('html_url', '')}

    def deploy_status(self, sha: str) -> str:
        """'success', 'failure', 'pending' or 'unknown', from the checks the hosting service reports to GitHub."""
        states = []
        try:
            combined = self._request('GET', self._repo_path(f'/commits/{sha}/status'))
            states += [s['state'] for s in combined.get('statuses', [])]
        except Exception:
            pass
        try:
            runs = self._request('GET', self._repo_path(f'/commits/{sha}/check-runs'))
            for r in runs.get('check_runs', []):
                states.append('pending' if r['status'] != 'completed' else ('success' if r['conclusion'] in ('success', 'neutral', 'skipped') else 'failure'))
        except Exception:
            pass
        if not states:
            return 'unknown'
        if any(s in ('failure', 'error') for s in states):
            return 'failure'
        if any(s == 'pending' for s in states):
            return 'pending'
        return 'success'


class LocalStore:
    """Reads and writes a website folder on this computer. Used for testing and for Kartik."""

    def __init__(self, root: str | os.PathLike):
        self.root = Path(root)
        if not (self.root / 'src/data/ceramic.json').exists():
            raise StoreError(f'{self.root} does not look like the website folder (src/data/ceramic.json missing).')

    def check(self) -> None:
        pass

    def read_json(self, path: str):
        data = (self.root / path).read_bytes()
        return json.loads(data.decode('utf-8')), git_blob_sha(data)

    def read_bytes(self, path: str) -> bytes:
        p = self.root / path
        if not p.is_file():
            raise FileNotFoundError(path)
        return p.read_bytes()

    def file_sha(self, path: str) -> str | None:
        p = self.root / path
        return git_blob_sha(p.read_bytes()) if p.is_file() else None

    def commit(self, files: dict[str, bytes], message: str, base_shas: dict[str, str]) -> dict:
        changed = [p for p, sha in base_shas.items() if self.file_sha(p) != sha]
        if changed:
            raise ConflictError(changed)
        for path, data in files.items():
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        (self.root / '.editor-last-commit.txt').write_text(message + '\n', encoding='utf-8')
        return {'sha': 'local', 'url': ''}

    def deploy_status(self, sha: str) -> str:
        return 'success'
