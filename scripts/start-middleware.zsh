#!/bin/zsh
set -euo pipefail

CRM_ROOT="/Users/nhdailabcenter/Desktop/some agents/tools-claude/ai crm"
NODE="/Users/nhdailabcenter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

cd "$CRM_ROOT/middleware"

set -a
source "$CRM_ROOT/.env"
set +a

mkdir -p uploads/conversation-files
export PORT=3002
export TWENTY_API_URL=http://localhost:3000
export DATABASE_URL="postgresql://${PG_DATABASE_USER:-postgres}:${PG_DATABASE_PASSWORD:-postgres}@127.0.0.1:15432/${PG_DATABASE_NAME:-default}"
export WAHA_API_URL=http://localhost:3003
export WAHA_API_KEY="${EVOLUTION_API_KEY}"
export WAHA_SESSION=default
export WAHA_WEBHOOK_URL=http://host.docker.internal:3002/api/whatsapp/webhook
export AI_SERVICE_URL=http://127.0.0.1:8790
export AI_SERVICE_API_KEY="${AI_SERVICE_API_KEY}"
export AI_SERVICE_TENANT_ID="${AI_SERVICE_TENANT_ID:-nhd}"
export WEBSITE_INGEST_SECRET="${WEBSITE_INGEST_SECRET}"
export AI_AGENT_USER="${AI_AGENT_USER:-admin}"
export AI_AGENT_PASSWORD="${AI_AGENT_PASSWORD:-admin123}"
export CONVERSATION_UPLOAD_DIR="$PWD/uploads/conversation-files"

exec "$NODE" index.js
