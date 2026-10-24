"""SVE Website Editor: lets the family add colours, photos and a few texts to the website without
touching any code. Start it by double-clicking the .exe (or `python editor/main.py`).

Options for testing:
  --local PATH       edit a website folder on this computer instead of GitHub
  --config-dir PATH  keep settings, key and draft somewhere else
  --api URL          talk to a different GitHub API (used by the automated tests)
  --port N           fixed port (default: any free port)
  --no-window        do not open a window; print the address instead
  --self-test        check this build works (used when building the .exe), then exit
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
import urllib.request
from pathlib import Path

from sve.config import Config
from sve.server import Editor, serve, ui_dir
from sve.window import open_window

IDLE_LIMIT = 120  # seconds without a sign of life from the window before the app closes itself


def self_test(config_dir: Path) -> int:
    from sve import images

    config = Config(config_dir)
    config.save_token('test-key-123')
    assert config.token() == 'test-key-123', 'key storage round trip failed'
    config.forget_token()

    from io import BytesIO

    from PIL import Image

    buf = BytesIO()
    Image.new('RGB', (3000, 1500), (31, 87, 168)).save(buf, 'PNG')
    prepared = images.prepare(buf.getvalue())
    assert prepared['width'] == 2000 and prepared['hex'] == '#1F57A8', prepared

    for name in ('index.html', 'app.css', 'app.js', 'emblem.svg', 'fonts/outfit.woff2'):
        assert (ui_dir() / name).is_file(), f'missing ui/{name}'

    httpd, url = serve(Editor(config, local_root=None), 0)
    key = url.split('k=')[1]
    with urllib.request.urlopen(url.split('/?')[0] + f'/api/state?k={key}', timeout=10) as r:
        state = json.loads(r.read())
    assert state['configured'] is False, state
    httpd.shutdown()
    print('self-test passed')
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description='SVE Website Editor')
    ap.add_argument('--local')
    ap.add_argument('--config-dir')
    ap.add_argument('--api')
    ap.add_argument('--port', type=int, default=0)
    ap.add_argument('--no-window', action='store_true')
    ap.add_argument('--self-test', action='store_true')
    args = ap.parse_args()

    config = Config(Path(args.config_dir) if args.config_dir else None)
    logging.basicConfig(
        filename=config.dir / 'editor.log',
        level=logging.INFO,
        format='%(asctime)s %(levelname)s %(message)s',
    )
    if args.self_test:
        try:
            return self_test(config.dir / 'self-test')
        except Exception:
            logging.exception('self-test failed')
            raise

    # Already open? Then just show another window onto the running editor.
    running = config.dir / 'running.json'
    if not args.no_window and not args.local:
        try:
            other = json.loads(running.read_text(encoding='utf-8'))['url']
            key = other.split('k=')[1]
            with urllib.request.urlopen(other.split('/?')[0] + f'/api/state?k={key}', timeout=2):
                pass
            open_window(other, config.dir / 'window')
            return 0
        except Exception:
            pass

    editor = Editor(config, local_root=args.local, api=args.api)
    httpd, url = serve(editor, args.port)
    logging.info('editor started at %s', url.split('?')[0])
    if not args.local:
        running.write_text(json.dumps({'url': url}), encoding='utf-8')

    if args.no_window:
        print(url, flush=True)
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            return 0

    window = open_window(url, config.dir / 'window')
    # Stay alive while the window is open. If we cannot track the window (a normal browser tab),
    # stop after the page has gone quiet for a while. Unpublished work is already saved as a draft.
    while True:
        time.sleep(2)
        if window is not None and window.poll() is not None:
            break
        if window is None and time.time() - editor.last_heartbeat > IDLE_LIMIT:
            break
    httpd.shutdown()
    try:
        running.unlink()
    except OSError:
        pass
    return 0


if __name__ == '__main__':
    sys.exit(main())
