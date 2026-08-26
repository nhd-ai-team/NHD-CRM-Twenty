#!/bin/zsh
set -euo pipefail

CRM_ROOT="/Users/nhdailabcenter/Desktop/some agents/tools-claude/ai crm"
AI_ROOT="/Users/nhdailabcenter/Desktop/测试/ai-customer-service-system"
PYTHON="/Users/nhdailabcenter/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3"

cd "$AI_ROOT"

set -a
source "$CRM_ROOT/.env"
source "$HOME/.hermes/.env" 2>/dev/null || true
set +a

export APP_ENV=development
export PORT=8790
export HOST=0.0.0.0
export DATABASE_PATH="$AI_ROOT/data/customer_service.sqlite3"
export KNOWLEDGE_ENGINE=local
export REQUIRE_INTEGRATION_AUTH=true
export INTEGRATION_API_KEY="${AI_SERVICE_API_KEY}"
export INTEGRATION_CLIENT_ID=nhd-crm-middleware
export INTEGRATION_TENANT_ID="${AI_SERVICE_TENANT_ID:-nhd}"
export OPENROUTER_API_BASE=http://127.0.0.1:8787/api/v1
export OPENROUTER_MODEL=openai/gpt-oss-120b
export OPENROUTER_TIMEOUT_MS=20000
export ALLOWED_ORIGINS="https://chinanhd.com,https://www.chinanhd.com,https://chinanhd.kinsta.cloud,https://aichatbot.chinanhd.com,https://staging.chinanhd.com,http://staging.chinanhd.com,http://localhost:8790,http://127.0.0.1:8790"
export CRM_WEBHOOK_URL=http://127.0.0.1:3002/api/website/webhook
export CRM_WEBHOOK_SECRET="${WEBSITE_INGEST_SECRET}"

exec "$PYTHON" -m app.server
