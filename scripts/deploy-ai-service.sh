#!/bin/zsh
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "$0")/.." && pwd)"
openrouter_env="${OPENROUTER_ENV_FILE:-/Users/nhdailabcenter/.hermes/.env}"

if [[ ! -r "$openrouter_env" ]]; then
  echo "OpenRouter environment file is not readable: $openrouter_env" >&2
  exit 1
fi

set -a
source "$openrouter_env"
set +a

if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
  echo "OPENROUTER_API_KEY is not configured in $openrouter_env" >&2
  exit 1
fi

export HTTP_PROXY="${HTTP_PROXY:-http://127.0.0.1:7890}"
export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:7890}"

docker compose -f "$project_dir/docker-compose.yml" --project-directory "$project_dir" build \
  --build-arg HTTP_PROXY=http://host.docker.internal:7890 \
  --build-arg HTTPS_PROXY=http://host.docker.internal:7890 \
  ai-service
docker compose -f "$project_dir/docker-compose.yml" --project-directory "$project_dir" up -d --no-deps ai-service
docker compose -f "$project_dir/docker-compose.yml" --project-directory "$project_dir" ps ai-service
