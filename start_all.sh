#!/usr/bin/env bash
set -euo pipefail

# -----------------------------
# Configuration
# -----------------------------
BACKEND_DIR="backend"
VENV_DIR="$BACKEND_DIR/.venv"
BACKEND_HOST="127.0.0.1"
BACKEND_PORT="8000"
BACKEND_APP="main:app"

FRONTEND_DIR="frontend"
# Vite-friendly; change if your frontend uses a different command
FRONTEND_CMD=("npm" "run" "dev")

# -----------------------------
# Validation
# -----------------------------
if [[ ! -f "$VENV_DIR/bin/activate" ]]; then
  echo "ERROR: Could not find $VENV_DIR/bin/activate"
  exit 1
fi
if [[ ! -d "$FRONTEND_DIR" ]]; then
  echo "ERROR: Could not find $FRONTEND_DIR directory"
  exit 1
fi

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  echo "Stopping services..."
  [[ -n "$FRONTEND_PID" ]] && kill -TERM "$FRONTEND_PID" 2>/dev/null || true
  [[ -n "$BACKEND_PID"  ]] && kill -TERM "$BACKEND_PID"  2>/dev/null || true
  [[ -n "$FRONTEND_PID" ]] && wait "$FRONTEND_PID" 2>/dev/null || true
  [[ -n "$BACKEND_PID"  ]] && wait "$BACKEND_PID"  2>/dev/null || true
}
trap cleanup INT TERM EXIT

# -----------------------------
# Start backend (inside venv)
# -----------------------------
echo "Activating backend virtual environment..."
# shellcheck disable=SC1090
source "$VENV_DIR/bin/activate"

echo "Starting backend..."
(
  cd "$BACKEND_DIR"
  exec python3 -m uvicorn "$BACKEND_APP" \
    --reload \
    --host "$BACKEND_HOST" \
    --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

# -----------------------------
# Wait until backend is reachable (avoid log spam / 404 issues)
# -----------------------------
echo "Waiting for backend TCP port $BACKEND_PORT..."
for i in {1..60}; do
  # Pure TCP connect probe (no bytes sent) to avoid uvicorn logging "Invalid HTTP request".
  if python3 - <<PY >/dev/null 2>&1
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(0.5)
try:
    s.connect(("127.0.0.1", int("$BACKEND_PORT")))
    s.close()
    raise SystemExit(0)
except Exception:
    raise SystemExit(1)
PY
  then
    echo "Backend port is open."
    break
  fi
  sleep 1
  if [[ "$i" -eq 60 ]]; then
    echo "ERROR: Backend port did not open in time."
    exit 1
  fi
done

# -----------------------------
# Start frontend
# -----------------------------
echo "Starting frontend..."
(
  cd "$FRONTEND_DIR"
  # Ensure dependencies are installed (common in fresh containers / after moving folders)
  if [[ ! -x "node_modules/.bin/vite" ]]; then
    echo "Frontend deps missing; running npm install..."
    npm install
  fi
  exec "${FRONTEND_CMD[@]}"
) &
FRONTEND_PID=$!

echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"

echo "Services started. Waiting..."
wait -n "$BACKEND_PID" "$FRONTEND_PID"
