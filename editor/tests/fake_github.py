"""A tiny stand-in for the GitHub API, for testing the editor without touching the real website.

Serves the files of a website folder as if it were a GitHub repository, and writes commits back into that
folder. Only the calls the editor makes are implemented.

    python editor/tests/fake_github.py <site folder> [--port 8790] [--token test-token]

Then, in the editor (served from localhost), set localStorage 'sve-editor-settings' to
{"api": "http://127.0.0.1:8790", "repo": "test/site", "branch": "main", ...} and use the token as the key.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def blob_sha(data: bytes) -> str:
    return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()


class Fake:
    def __init__(self, root: Path, token: str):
        self.root = root
        self.token = token
        self.head = uuid.uuid4().hex
        self.blobs: dict[str, bytes] = {}
        self.trees: dict[str, dict] = {}
        self.commits: dict[str, dict] = {}
        self.log: list[dict] = []  # every commit made, for the tests to inspect


def make_handler(fake: Fake):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, obj=None):
            body = b'' if obj is None else json.dumps(obj).encode()
            self.send_response(code)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-GitHub-Api-Version, Accept')
            self.end_headers()

        def _auth(self):
            if self.headers.get('Authorization') != f'Bearer {fake.token}':
                self._send(401, {'message': 'Bad credentials'})
                return False
            return True

        def _body(self):
            n = int(self.headers.get('Content-Length') or 0)
            return json.loads(self.rfile.read(n) or b'{}')

        def do_GET(self):
            if self.path == '/_log':
                return self._send(200, fake.log)
            if not self._auth():
                return
            path = self.path.split('?')[0]
            m = re.fullmatch(r'/repos/[^/]+/[^/]+', path)
            if m:
                return self._send(200, {'permissions': {'push': True}})
            if re.fullmatch(r'/repos/[^/]+/[^/]+/branches/[^/]+', path):
                return self._send(200, {'name': 'main'})
            m = re.fullmatch(r'/repos/[^/]+/[^/]+/contents/(.+)', path)
            if m:
                from urllib.parse import unquote

                f = fake.root / unquote(m.group(1))
                if not f.is_file():
                    return self._send(404, {'message': 'Not Found'})
                data = f.read_bytes()
                return self._send(200, {'content': base64.b64encode(data).decode(), 'sha': blob_sha(data), 'encoding': 'base64'})
            if re.fullmatch(r'/repos/[^/]+/[^/]+/git/ref/heads/.+', path):
                return self._send(200, {'object': {'sha': fake.head}})
            m = re.fullmatch(r'/repos/[^/]+/[^/]+/git/commits/(\w+)', path)
            if m:
                return self._send(200, {'tree': {'sha': 'tree-' + m.group(1)}})
            if re.fullmatch(r'/repos/[^/]+/[^/]+/commits/\w+/status', path):
                return self._send(200, {'statuses': [{'state': 'success'}]})
            if re.fullmatch(r'/repos/[^/]+/[^/]+/commits/\w+/check-runs', path):
                return self._send(200, {'check_runs': []})
            return self._send(404, {'message': 'Not Found'})

        def do_POST(self):
            if not self._auth():
                return
            path = self.path.split('?')[0]
            body = self._body()
            if path.endswith('/git/blobs'):
                data = base64.b64decode(body['content']) if body.get('encoding') == 'base64' else body['content'].encode()
                sha = blob_sha(data)
                fake.blobs[sha] = data
                return self._send(201, {'sha': sha})
            if path.endswith('/git/trees'):
                sha = uuid.uuid4().hex
                fake.trees[sha] = body
                return self._send(201, {'sha': sha})
            if path.endswith('/git/commits'):
                sha = uuid.uuid4().hex
                fake.commits[sha] = body
                return self._send(201, {'sha': sha, 'html_url': f'https://github.com/test/site/commit/{sha}'})
            return self._send(404, {'message': 'Not Found'})

        def do_PATCH(self):
            if not self._auth():
                return
            body = self._body()
            commit = fake.commits.get(body.get('sha'))
            if not commit or commit['parents'] != [fake.head]:
                return self._send(422, {'message': 'Update is not a fast forward'})
            files = {}
            for entry in fake.trees[commit['tree']]['tree']:
                data = fake.blobs[entry['sha']]
                target = fake.root / entry['path']
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                files[entry['path']] = len(data)
            fake.head = body['sha']
            fake.log.append({'message': commit['message'], 'files': files})
            return self._send(200, {'object': {'sha': fake.head}})

    return H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root')
    ap.add_argument('--port', type=int, default=8790)
    ap.add_argument('--token', default='test-token')
    a = ap.parse_args()
    fake = Fake(Path(a.root), a.token)
    print(f'fake GitHub on http://127.0.0.1:{a.port} serving {a.root}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', a.port), make_handler(fake)).serve_forever()


if __name__ == '__main__':
    main()
