#!/bin/bash
# Start both inference server (port 8765) and agent server (port 8766)
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================="
echo "  Pollinator Drone — Dual Server Startup"
echo "========================================="

# Load .env if present
if [ -f "$SCRIPT_DIR/.env" ]; then
    echo "[env] Loading .env…"
    set -a; source "$SCRIPT_DIR/.env"; set +a
fi

echo "[1/2] Starting Inference Server on :8765…"
python3 "$SCRIPT_DIR/inference_server.py" &
INFERENCE_PID=$!

sleep 1

echo "[2/2] Starting Agent Server on :8766…"
python3 "$SCRIPT_DIR/agent_server.py" &
AGENT_PID=$!

echo ""
echo "Both servers running."
echo "  Inference PID = $INFERENCE_PID  →  ws://localhost:8765/inference"
echo "  Agent PID     = $AGENT_PID      →  http://localhost:8766"
echo ""
echo "Press Ctrl+C to stop both."

trap "echo 'Stopping servers…'; kill $INFERENCE_PID $AGENT_PID 2>/dev/null; exit 0" EXIT INT TERM

wait
