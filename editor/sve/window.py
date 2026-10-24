"""Open the editor in its own window. On Windows 10/11 that is Microsoft Edge in "app" mode:
no address bar or tabs, so it looks and behaves like a normal program."""

from __future__ import annotations

import os
import subprocess
import sys
import webbrowser
from pathlib import Path


def find_edge() -> str | None:
    candidates = []
    for env in ('PROGRAMFILES(X86)', 'PROGRAMFILES', 'LOCALAPPDATA'):
        base = os.environ.get(env)
        if base:
            candidates.append(Path(base) / 'Microsoft/Edge/Application/msedge.exe')
    for c in candidates:
        if c.is_file():
            return str(c)
    return None


def open_window(url: str, profile_dir: Path) -> subprocess.Popen | None:
    """Returns the window's process when we can track it (so the app can exit when it closes)."""
    if sys.platform == 'win32':
        edge = find_edge()
        if edge:
            profile_dir.mkdir(parents=True, exist_ok=True)
            return subprocess.Popen(
                [
                    edge,
                    f'--app={url}',
                    f'--user-data-dir={profile_dir}',
                    '--window-size=1320,900',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--disable-features=Translate',
                ]
            )
    webbrowser.open(url)
    return None
