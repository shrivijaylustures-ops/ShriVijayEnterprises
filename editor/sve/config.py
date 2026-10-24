"""Settings and the GitHub key, stored per Windows user.

On Windows the key is encrypted with the Windows user's own login (DPAPI), so copying the file
to another computer or user does not reveal it. Elsewhere it is a file readable only by this user.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

APP_NAME = 'SVE Website Editor'
DEFAULTS = {
    'repo': 'shrivijaylustures-ops/ShriVijayEnterprises',
    'branch': 'main',
    'site_url': 'https://www.shrivijayenterprises.in',
}


def app_dir() -> Path:
    if sys.platform == 'win32':
        base = Path(os.environ.get('APPDATA', Path.home() / 'AppData/Roaming'))
    else:
        base = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config'))
    d = base / APP_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


class Config:
    def __init__(self, directory: Path | None = None):
        self.dir = directory or app_dir()
        self.dir.mkdir(parents=True, exist_ok=True)
        self.settings_file = self.dir / 'settings.json'
        self.token_file = self.dir / 'github-key.bin'

    # -- Settings -------------------------------------------------------------

    def settings(self) -> dict:
        try:
            saved = json.loads(self.settings_file.read_text(encoding='utf-8'))
        except (OSError, ValueError):
            saved = {}
        return {**DEFAULTS, **{k: v for k, v in saved.items() if k in DEFAULTS}}

    def save_settings(self, values: dict) -> None:
        merged = {**self.settings(), **{k: v for k, v in values.items() if k in DEFAULTS}}
        self.settings_file.write_text(json.dumps(merged, indent=2), encoding='utf-8')

    # -- Key --------------------------------------------------------------------

    def token(self) -> str | None:
        try:
            blob = self.token_file.read_bytes()
        except OSError:
            return None
        try:
            return (_unprotect(blob) if sys.platform == 'win32' else blob).decode('utf-8')
        except Exception:
            return None

    def save_token(self, token: str) -> None:
        data = token.strip().encode('utf-8')
        self.token_file.write_bytes(_protect(data) if sys.platform == 'win32' else data)
        if sys.platform != 'win32':
            os.chmod(self.token_file, 0o600)

    def forget_token(self) -> None:
        try:
            self.token_file.unlink()
        except OSError:
            pass


# -- Windows DPAPI ---------------------------------------------------------------

if sys.platform == 'win32':
    import ctypes
    from ctypes import wintypes

    class _Blob(ctypes.Structure):
        _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_char))]

    def _to_blob(data: bytes) -> _Blob:
        buf = ctypes.create_string_buffer(data, len(data))
        return _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))

    def _from_blob(blob: _Blob) -> bytes:
        out = ctypes.string_at(blob.pbData, blob.cbData)
        ctypes.windll.kernel32.LocalFree(blob.pbData)
        return out

    def _protect(data: bytes) -> bytes:
        out = _Blob()
        if not ctypes.windll.crypt32.CryptProtectData(ctypes.byref(_to_blob(data)), APP_NAME, None, None, None, 0, ctypes.byref(out)):
            raise OSError('Could not encrypt the key')
        return _from_blob(out)

    def _unprotect(data: bytes) -> bytes:
        out = _Blob()
        if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(_to_blob(data)), None, None, None, None, 0, ctypes.byref(out)):
            raise OSError('Could not decrypt the key')
        return _from_blob(out)
else:

    def _protect(data: bytes) -> bytes:
        return data

    def _unprotect(data: bytes) -> bytes:
        return data
