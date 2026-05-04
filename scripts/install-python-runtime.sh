#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BOOTSTRAP_PYTHON="${PYTHON_BOOTSTRAP:-python3}"
VENV_DIR="${PYTHON_RUNTIME_VENV:-$ROOT_DIR/.venv-pipelines}"
PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$ROOT_DIR/.cache/ms-playwright}"
PATCHRIGHT_BROWSERS_PATH="${PATCHRIGHT_BROWSERS_PATH:-$ROOT_DIR/.cache/ms-patchright}"

if ! command -v "$BOOTSTRAP_PYTHON" >/dev/null 2>&1; then
  echo "Python bootstrap executable not found: $BOOTSTRAP_PYTHON" >&2
  exit 1
fi

"$BOOTSTRAP_PYTHON" - <<'PY'
import sys
if sys.version_info < (3, 10):
    raise SystemExit("Python 3.10+ is required for Pilot pipelines")
PY

if [ ! -d "$VENV_DIR" ]; then
  "$BOOTSTRAP_PYTHON" -m venv "$VENV_DIR"
fi

VENV_PY="$VENV_DIR/bin/python"

"$VENV_PY" -m pip install --upgrade pip setuptools wheel >/dev/null
"$VENV_PY" -m pip install --timeout 180 --retries 10 -r "$ROOT_DIR/pipelines/requirements.txt"

export PLAYWRIGHT_BROWSERS_PATH
export PATCHRIGHT_BROWSERS_PATH
mkdir -p "$ROOT_DIR/data/storage/adaptive" "$ROOT_DIR/data/storage/raw" "$ROOT_DIR/data/storage/crawls"
"$VENV_PY" -m playwright install chromium
"$VENV_PY" -m patchright install chromium

echo "Python runtime ready"
echo "  PYTHON_BIN=$VENV_PY"
echo "  PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH"
echo "  PATCHRIGHT_BROWSERS_PATH=$PATCHRIGHT_BROWSERS_PATH"
