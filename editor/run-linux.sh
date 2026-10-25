#!/usr/bin/env bash
# Open the website editor in its own window on Linux. It is the same editor as the website's /editor/ page
# and the Android app (editor/ui), served from this folder, so changes to it can be tried before publishing.
#
#   ./editor/run-linux.sh                     real mode: the first time, it asks for the GitHub key (publishing is live)
#   ./editor/run-linux.sh --practice          practice mode: reads the website, never changes it
#   ./editor/run-linux.sh --screen 1093x614   open the window at your dad's screen size
#
# Needs python3 and Chrome, Chromium or Edge. The key and unsaved changes stay in this window's own profile.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
port=8795
page=''
window='--start-maximized'
while [ $# -gt 0 ]; do
  case "$1" in
    --practice | --test) page='?practice' ;;
    --screen) shift; window="--window-size=${1/x/,}" ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
  shift
done

browser=''
for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
  if command -v "$b" >/dev/null; then browser="$b"; break; fi
done
[ -z "$browser" ] && { echo "Install Google Chrome or Chromium first."; exit 1; }

python3 -m http.server "$port" --bind 127.0.0.1 --directory "$here/ui" >/dev/null 2>&1 &
server=$!
trap 'kill $server 2>/dev/null' EXIT
sleep 0.5

profile="${XDG_DATA_HOME:-$HOME/.local/share}/sve-editor/window"
mkdir -p "$profile"
"$browser" --app="http://127.0.0.1:$port/$page" --user-data-dir="$profile" "$window" --no-first-run --no-default-browser-check
