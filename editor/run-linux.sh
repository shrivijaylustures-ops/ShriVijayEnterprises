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

# Set up (or repair) a private Python environment with Pillow. Uses uv if present, else python3 -m venv.
if ! "$venv/bin/python" -c "import PIL" 2>/dev/null; then
  echo "Setting up the editor (first run only)..."
  rm -rf "$venv"
  uv="$(command -v uv || true)"
  [ -z "$uv" ] && [ -x "$HOME/.local/bin/uv" ] && uv="$HOME/.local/bin/uv"
  if [ -n "$uv" ]; then
    "$uv" venv --quiet "$venv"
    "$uv" pip install --quiet --python "$venv/bin/python" -r "$here/requirements.txt"
  elif python3 -m venv "$venv" 2>/dev/null; then
    "$venv/bin/pip" install --quiet -r "$here/requirements.txt"
  else
    rm -rf "$venv"
    echo "Python's venv module is missing. Install it once with:  sudo apt install python3-venv"
    echo "(or install uv:  curl -LsSf https://astral.sh/uv/install.sh | sh)"
    exit 1
  fi
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
