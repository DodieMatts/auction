#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

COMPOSE_FILE="docker-compose.production.yml"
ENV_FILE=".env.production"
ENV_EXAMPLE=".env.production.example"
APP_ORIGIN="http://localhost:8080"

DEV_ADMIN_EMAIL="${DEV_ADMIN_EMAIL:-admin@auction.local}"
DEV_ADMIN_PASSWORD="${DEV_ADMIN_PASSWORD:-AuctionAdmin123!}"
DEV_BIDDER_EMAIL="${DEV_BIDDER_EMAIL:-bidder@auction.local}"
DEV_BIDDER_PASSWORD="${DEV_BIDDER_PASSWORD:-AuctionBidder123!}"

RESET_DATABASE=false
RUN_CONTAINER_VERIFICATION=false

usage() {
  cat <<'HELP'
Usage: bash scripts/bootstrap-local-production.sh [options]

Options:
  --reset    Delete the local Docker volume before rebuilding.
  --verify   Run npm run verify:production-containers after setup.
  --help     Show this help text.

Environment overrides:
  DEV_ADMIN_EMAIL
  DEV_ADMIN_PASSWORD
  DEV_BIDDER_EMAIL
  DEV_BIDDER_PASSWORD
HELP
}

for argument in "$@"; do
  case "${argument}" in
    --reset) RESET_DATABASE=true ;;
    --verify) RUN_CONTAINER_VERIFICATION=true ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: ${argument}" >&2; usage >&2; exit 1 ;;
  esac
done

require_command() {
  local command_name="$1"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Missing required command: ${command_name}" >&2
    exit 1
  fi
}

require_command docker
require_command curl
require_command openssl
require_command awk
require_command grep
require_command mktemp

if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but the Docker daemon is not running." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required. Use: docker compose ..." >&2
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Missing ${COMPOSE_FILE}. Run this script from the repository." >&2
  exit 1
fi

get_env_value() {
  local key="$1"
  awk -F= -v key="${key}" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "${ENV_FILE}" 2>/dev/null || true
}

is_missing_or_placeholder() {
  local value="$1"
  [[ -z "${value}" || "${value}" == *"replace-with"* || "${value}" == *"changeme"* || "${value}" == *"<"* || "${value}" == *">"* ]]
}

set_env_value() {
  local key="$1"
  local value="$2"
  local temporary_file
  temporary_file="$(mktemp)"

  if grep -q "^${key}=" "${ENV_FILE}" 2>/dev/null; then
    awk -v key="${key}" -v value="${value}" '
      BEGIN { replaced = 0 }
      index($0, key "=") == 1 && replaced == 0 {
        print key "=" value
        replaced = 1
        next
      }
      { print }
    ' "${ENV_FILE}" > "${temporary_file}"
  else
    cat "${ENV_FILE}" > "${temporary_file}" 2>/dev/null || true
    [[ -s "${temporary_file}" ]] && printf "\n" >> "${temporary_file}"
    printf "%s=%s\n" "${key}" "${value}" >> "${temporary_file}"
  fi

  mv "${temporary_file}" "${ENV_FILE}"
}

ensure_env_value() {
  local key="$1"
  local default_value="$2"
  local current_value
  current_value="$(get_env_value "${key}")"
  if is_missing_or_placeholder "${current_value}"; then
    set_env_value "${key}" "${default_value}"
  fi
}

if [[ ! -f "${ENV_FILE}" ]]; then
  if [[ -f "${ENV_EXAMPLE}" ]]; then
    cp "${ENV_EXAMPLE}" "${ENV_FILE}"
    echo "Created ${ENV_FILE} from ${ENV_EXAMPLE}."
  else
    : > "${ENV_FILE}"
    echo "Created ${ENV_FILE}."
  fi
fi

generated_postgres_password="$(openssl rand -hex 24)"
generated_jwt_secret="$(openssl rand -hex 32)"

ensure_env_value "POSTGRES_USER" "auction"
ensure_env_value "POSTGRES_PASSWORD" "${generated_postgres_password}"
ensure_env_value "POSTGRES_DB" "auction"

postgres_user="$(get_env_value "POSTGRES_USER")"
postgres_password="$(get_env_value "POSTGRES_PASSWORD")"
postgres_database="$(get_env_value "POSTGRES_DB")"

ensure_env_value "NODE_ENV" "production"
ensure_env_value "HOST" "0.0.0.0"
ensure_env_value "PORT" "3000"
ensure_env_value "DATABASE_URL" "postgresql://${postgres_user}:${postgres_password}@postgres:5432/${postgres_database}?schema=public"
ensure_env_value "DATABASE_POOL_MAX" "10"
ensure_env_value "DATABASE_CONNECTION_TIMEOUT_MS" "5000"
ensure_env_value "DATABASE_IDLE_TIMEOUT_MS" "30000"
ensure_env_value "JWT_ACCESS_SECRET" "${generated_jwt_secret}"
ensure_env_value "JWT_ACCESS_TTL_SECONDS" "900"
ensure_env_value "JWT_ISSUER" "auction-api"
ensure_env_value "JWT_AUDIENCE" "auction-web"
ensure_env_value "ALLOWED_APP_ORIGIN" "${APP_ORIGIN}"
ensure_env_value "API_BASE_URL" "http://api:3000/api"
chmod 600 "${ENV_FILE}"

compose() {
  docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}" "$@"
}

if [[ "${RESET_DATABASE}" == "true" ]]; then
  echo "Removing the local application containers, network, and database volume..."
  compose down -v --remove-orphans
fi

echo "Building and starting PostgreSQL, migrations, API, web, and Nginx..."
compose up -d --build --force-recreate

echo "Waiting for ${APP_ORIGIN}/healthz..."
health_ready=false
attempt=1
while [[ "${attempt}" -le 60 ]]; do
  if curl -fsS "${APP_ORIGIN}/healthz" >/dev/null 2>&1; then
    health_ready=true
    break
  fi
  sleep 2
  attempt=$((attempt + 1))
done

if [[ "${health_ready}" != "true" ]]; then
  echo "The application did not become healthy." >&2
  compose ps -a >&2 || true
  compose logs --tail=100 api web nginx >&2 || true
  exit 1
fi

echo "Seeding the local administrator and bidder accounts..."
compose run --rm \
  -e NODE_ENV=development \
  -e DEV_ADMIN_EMAIL="${DEV_ADMIN_EMAIL}" \
  -e DEV_ADMIN_PASSWORD="${DEV_ADMIN_PASSWORD}" \
  -e DEV_BIDDER_EMAIL="${DEV_BIDDER_EMAIL}" \
  -e DEV_BIDDER_PASSWORD="${DEV_BIDDER_PASSWORD}" \
  migrate npm run db:seed --workspace apps/api

temporary_directory="$(mktemp -d)"
trap 'rm -rf "${temporary_directory}"' EXIT

verify_login() {
  local label="$1"
  local email="$2"
  local password="$3"
  local response_file="${temporary_directory}/${label}.json"
  local status_code

  status_code="$(
    curl -sS \
      -o "${response_file}" \
      -w "%{http_code}" \
      -c "${temporary_directory}/${label}-cookies.txt" \
      -H "Content-Type: application/json" \
      -H "Origin: ${APP_ORIGIN}" \
      -H "Referer: ${APP_ORIGIN}/login" \
      -d "{\"email\":\"${email}\",\"password\":\"${password}\"}" \
      "${APP_ORIGIN}/api/auth/login"
  )"

  if [[ "${status_code}" != "200" ]]; then
    echo "${label} login check failed with HTTP ${status_code}." >&2
    cat "${response_file}" >&2 || true
    exit 1
  fi

  echo "${label} login check passed."
}

verify_login "admin" "${DEV_ADMIN_EMAIL}" "${DEV_ADMIN_PASSWORD}"
verify_login "bidder" "${DEV_BIDDER_EMAIL}" "${DEV_BIDDER_PASSWORD}"

echo "Confirming seeded users..."
compose exec -T postgres sh -lc \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT email, role, status FROM \"User\" ORDER BY email;"'

if [[ "${RUN_CONTAINER_VERIFICATION}" == "true" ]]; then
  require_command node
  require_command npm
  current_node_version="$(node -p 'process.versions.node')"
  required_node_version="20.19.0"

  if [[ "${current_node_version}" != "${required_node_version}" ]]; then
    if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
      # shellcheck source=/dev/null
      source "${HOME}/.nvm/nvm.sh"
      nvm install "${required_node_version}"
      nvm use "${required_node_version}"
    else
      echo "Container verification requires Node ${required_node_version}; current version is ${current_node_version}." >&2
      echo "Install/use Node ${required_node_version}, then run: npm run verify:production-containers" >&2
      exit 1
    fi
  fi

  npm run verify:production-containers
fi

cat <<SUMMARY

Local production-style environment is ready.

Application:
  ${APP_ORIGIN}

Administrator:
  Email:    ${DEV_ADMIN_EMAIL}
  Password: ${DEV_ADMIN_PASSWORD}

Bidder:
  Email:    ${DEV_BIDDER_EMAIL}
  Password: ${DEV_BIDDER_PASSWORD}

Useful commands:
  Logs:   docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} logs -f api web nginx
  Status: docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} ps -a
  Stop:   docker compose -f ${COMPOSE_FILE} --env-file ${ENV_FILE} down
  Reset:  npm run setup:local:reset

Do not commit ${ENV_FILE}; it contains local secrets.
SUMMARY
