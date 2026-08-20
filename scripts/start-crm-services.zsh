#!/bin/zsh
set -euo pipefail

ROOT="/Users/nhdailabcenter/Desktop/some agents/tools-claude/ai crm"
RUNTIME_DIR="$ROOT/.codex-runtime"
LOG_FILE="$RUNTIME_DIR/autostart.log"
DOCKER="/opt/homebrew/bin/docker"
CURL="/usr/bin/curl"
SCREEN="/usr/bin/screen"

mkdir -p "$RUNTIME_DIR"
exec >> "$LOG_FILE" 2>&1

echo ""
echo "[$(/bin/date '+%Y-%m-%d %H:%M:%S')] starting CRM services"
cd "$ROOT"

if ! "$DOCKER" info >/dev/null 2>&1; then
  echo "Docker is not ready; opening Docker Desktop"
  /usr/bin/open -ga Docker || true
fi

for i in {1..90}; do
  if "$DOCKER" info >/dev/null 2>&1; then
    echo "Docker is ready"
    break
  fi
  if [ "$i" -eq 90 ]; then
    echo "Docker did not become ready in time"
    exit 1
  fi
  /bin/sleep 2
done

cat > "$RUNTIME_DIR/docker-compose.db-port.yml" <<'YAML'
services:
  db:
    ports:
      - "127.0.0.1:15432:5432"
YAML

echo "Starting Docker services"
"$DOCKER" compose -f docker-compose.yml -f "$RUNTIME_DIR/docker-compose.db-port.yml" up -d \
  db redis server worker twenty-portal chat-ui waha

echo "Waiting for Twenty health"
for i in {1..90}; do
  if "$CURL" -fsS http://127.0.0.1:3000/healthz >/dev/null 2>&1; then
    echo "Twenty is healthy"
    break
  fi
  if [ "$i" -eq 90 ]; then
    echo "Twenty health check did not pass in time"
    exit 1
  fi
  /bin/sleep 2
done

echo "Starting AI service screen"
"$SCREEN" -S ai-crm-ai-service -X quit >/dev/null 2>&1 || true
"$SCREEN" -dmS ai-crm-ai-service /bin/zsh "$ROOT/scripts/start-ai-service.zsh"

echo "Starting middleware screen"
"$SCREEN" -S ai-crm-middleware -X quit >/dev/null 2>&1 || true
"$SCREEN" -dmS ai-crm-middleware /bin/zsh "$ROOT/scripts/start-middleware.zsh"

echo "Waiting for middleware health"
for i in {1..45}; do
  if "$CURL" -fsS http://127.0.0.1:3002/health >/dev/null 2>&1; then
    echo "Middleware is healthy"
    break
  fi
  if [ "$i" -eq 45 ]; then
    echo "Middleware health check did not pass in time"
    exit 1
  fi
  /bin/sleep 2
done

set +u
source "$ROOT/.env" >/dev/null 2>&1 || true
set -u

if [ -n "${EVOLUTION_API_KEY:-}" ]; then
  if ! "$CURL" -fsS -H "X-Api-Key: $EVOLUTION_API_KEY" http://127.0.0.1:3003/api/sessions/default >/dev/null 2>&1; then
    echo "Creating WAHA default session"
    "$CURL" -fsS -X POST \
      -H "X-Api-Key: $EVOLUTION_API_KEY" \
      -H "Content-Type: application/json" \
      http://127.0.0.1:3003/api/sessions/start \
      -d '{"name":"default","config":{"webhooks":[{"url":"http://middleware:3002/api/whatsapp/webhook","events":["message","message.ack","session.status"]}]}}' >/dev/null || true
  fi
fi

echo "[$(/bin/date '+%Y-%m-%d %H:%M:%S')] CRM services started"
