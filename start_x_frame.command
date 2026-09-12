#!/bin/zsh

set -u

ROOT_DIR="${0:A:h}"
PORT="${PORT:-5179}"
URL="http://127.0.0.1:${PORT}"

cd "$ROOT_DIR" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found in PATH."
  echo "Install Node.js, then run this launcher again."
  read -r "?Press Return to close..."
  exit 1
fi

if nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1; then
  echo "X-Frame is already running at ${URL}"
  open "$URL"
  exit 0
fi

echo "Starting X-Frame..."
echo "Project: ${ROOT_DIR}"
echo "URL: ${URL}"
echo "Keep this terminal window open while using the tuner."
echo

(sleep 0.8; open "$URL") &
exec node tools/animation_tuner/server.js
