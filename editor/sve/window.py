"""Open the editor in its own window: Microsoft Edge (Windows) or Chrome/Chromium (Linux) in "app" mode,
with no address bar or tabs, so it looks and behaves like a normal program."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import webbrowser
from pathlib import Path


def find_browser() -> str | None:
    if sys.platform == 'win32':
        for env in ('PROGRAMFILES(X86)', 'PROGRAMFILES', 'LOCALAPPDATA'):
            base = os.environ.get(env)
            if base and (Path(base) / 'Microsoft/Edge/Application/msedge.exe').is_file():
                return str(Path(base) / 'Microsoft/Edge/Application/msedge.exe')
        return None
    for name in ('microsoft-edge', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'):
        found = shutil.which(name)
        if found:
            return found
    return None


def open_window(url: str, profile_dir: Path, size: str | None = None) -> None:
    """size: 'WIDTHxHEIGHT' to imitate a smaller screen (testing); otherwise the window opens maximized,
    so it always fits the screen it is on. A fixed size once pushed the Save button off small laptop screens."""
    browser = find_browser()
    if not browser:
        webbrowser.open(url)
        return
    profile_dir.mkdir(parents=True, exist_ok=True)
    window = f'--window-size={size.replace("x", ",")}' if size else '--start-maximized'
    subprocess.Popen(
        [
            browser,
            f'--app={url}',
            f'--user-data-dir={profile_dir}',
            window,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-features=Translate',
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
