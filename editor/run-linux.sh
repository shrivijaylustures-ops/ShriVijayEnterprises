#!/usr/bin/env bash
# Run the website editor on Linux, the same program your dad gets as the .exe.
#
#   ./editor/run-linux.sh                     real mode: talks to GitHub with the key you set up (publishing is live)
#   ./editor/run-linux.sh --test              practice mode: edits a throwaway copy of this folder, nothing is published
#   ./editor/run-linux.sh --screen 1093x614   open the window at your dad's screen size (works with --test too)
#
# First run creates a small Python environment in ~/.local/share/sve-editor (needs python3 and python3-venv).
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(dirname "$here")"
venv="${XDG_DATA_HOME:-$HOME/.local/share}/sve-editor/venv"

if [ ! -x "$venv/bin/python" ]; then
  echo "Setting up the editor (first run only)..."
  python3 -m venv "$venv"
  "$venv/bin/pip" install --quiet -r "$here/requirements.txt"
fi

args=()
test_mode=0
while [ $# -gt 0 ]; do
  case "$1" in
    --test) test_mode=1 ;;
    *) args+=("$1") ;;
  esac
  shift
done

if [ "$test_mode" = 1 ]; then
  copy="$(mktemp -d /tmp/sve-editor-test.XXXXXX)"
  echo "Practice mode: editing a copy in $copy (deleted when you close this)."
  tar -C "$repo" --exclude=./node_modules --exclude=./dist --exclude=./.git --exclude=./.astro -cf - . | tar -xf - -C "$copy"
  trap 'rm -rf "$copy"' EXIT
  args+=(--local "$copy" --config-dir "$copy/.editor-config")
fi

"$venv/bin/python" "$here/main.py" "${args[@]+"${args[@]}"}"
