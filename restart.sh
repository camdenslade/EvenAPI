#!/usr/bin/env bash
set -euo pipefail

APP_NAME="even-backend"
APP_ENV="production"

if [ "$EUID" -eq 0 ]; then
  echo "Do NOT run this script with sudo"
  exit 1
fi

echo "--- Restarting $APP_NAME ($APP_ENV)"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

echo "--- Working directory: $(pwd)"
echo "--- Running as user: $(whoami)"

echo "--- Cleaning dist..."
rm -rf dist

echo "--- Building backend..."
npm run build

echo "--- Stopping existing PM2 app..."
pm2 delete "$APP_NAME" 2>/dev/null || true

echo "--- Loading app env secrets..."

APP_ENV_JSON="$(
  aws secretsmanager get-secret-value \
    --secret-id even/alpha/app-env \
    --query SecretString \
    --output text
)"

# Export key=value pairs safely
while IFS== read -r key value; do
  export "$key=$value"
done < <(echo "$APP_ENV_JSON" | jq -r 'to_entries[] | "\(.key)=\(.value)"')

echo "--- Loading Google Vision service account..."

export GOOGLE_VISION_CREDENTIALS="$(
  aws secretsmanager get-secret-value \
    --secret-id even/alpha/vision-mod \
    --query SecretString \
    --output text
)"

if [ -z "${GOOGLE_VISION_CREDENTIALS:-}" ]; then
  echo "GOOGLE_VISION_CREDENTIALS missing"
  exit 1
fi

echo "-- POSTGRES_HOST=${POSTGRES_HOST:-missing}"
echo "-- GOOGLE_VISION_CREDENTIALS loaded ($(echo "$GOOGLE_VISION_CREDENTIALS" | wc -c | tr -d ' ') bytes)"

echo "--- Starting PM2..."
pm2 start ecosystem.config.js --env production

# Persist PM2 state
pm2 save

echo "Restart complete. Use: pm2 logs $APP_NAME"