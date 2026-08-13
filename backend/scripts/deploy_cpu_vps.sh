#!/usr/bin/env bash
set -euo pipefail

REMOTE_DIR=${REMOTE_DIR:-/opt/cleaner-cpu}
HOST=${VPS_HOST:?defina VPS_HOST}
USER=${VPS_SSH_USER:-root}
APP_ORIGIN=${APP_ORIGIN:?defina APP_ORIGIN, por exemplo https://app.example.com}
PUBLIC_HOST=${CLEANER_PUBLIC_HOST:?defina CLEANER_PUBLIC_HOST}
BIND_PORT=${CLEANER_BIND_PORT:-8096}

[[ "$APP_ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || { echo "APP_ORIGIN invalida"; exit 2; }
[[ "$PUBLIC_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "CLEANER_PUBLIC_HOST invalido"; exit 2; }
[[ "$BIND_PORT" =~ ^[0-9]+$ ]] || { echo "CLEANER_BIND_PORT invalida"; exit 2; }

echo "==> Enviando release para $USER@$HOST:$REMOTE_DIR"
ssh "$USER@$HOST" "mkdir -p '$REMOTE_DIR'"
rsync -az --delete \
  --exclude data --exclude .env --exclude __pycache__ --exclude '*.pyc' \
  ./app ./scripts ./requirements-cpu.txt ./Dockerfile.cpu ./docker-compose.cpu.yml \
  ./Caddyfile.cleaner "$USER@$HOST:$REMOTE_DIR/"

ssh "$USER@$HOST" \
  "REMOTE_DIR='$REMOTE_DIR' APP_ORIGIN='$APP_ORIGIN' PUBLIC_HOST='$PUBLIC_HOST' BIND_PORT='$BIND_PORT' bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo "Docker Engine com Compose plugin e obrigatorio; instale pelo repositorio oficial do sistema."
  exit 3
fi
if ! command -v caddy >/dev/null 2>&1; then
  echo "Caddy e obrigatorio para publicar o worker somente por HTTPS."
  exit 3
fi

umask 077
SECRET=""
if [[ -f .env ]]; then
  SECRET=$(sed -n 's/^CLEANER_WORKER_SECRET=//p' .env | head -n1)
fi
if [[ ${#SECRET} -lt 32 ]]; then
  for container in $(docker ps -q); do
    candidate=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" 2>/dev/null \
      | sed -n 's/^CLEANER_WORKER_SECRET=//p' | head -n1)
    if [[ ${#candidate} -ge 32 && "$candidate" != "default_secret" ]]; then
      SECRET=$candidate
      break
    fi
  done
fi
if [[ ${#SECRET} -lt 32 || "$SECRET" == "default_secret" ]]; then
  SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n')
fi

cat > .env <<ENV
CLEANER_WORKER_SECRET=$SECRET
CORS_ORIGINS=$APP_ORIGIN
CLEANER_CALLBACK_ORIGINS=$APP_ORIGIN
CLEANER_ALLOWED_HOSTS=$PUBLIC_HOST,localhost,127.0.0.1
CLEANER_BIND_PORT=$BIND_PORT
CLEANER_MAX_UPLOAD_GB=2
CLEANER_MAX_DURATION_SECONDS=3600
CLEANER_MAX_WIDTH=3840
CLEANER_MAX_HEIGHT=2160
CLEANER_MAX_FPS=60
CLEANER_STORAGE_QUOTA_GB=50
CLEANER_MIN_FREE_GB=10
CLEANER_RETENTION_HOURS=72
CLEANER_RATE_LIMIT_PER_MINUTE=120
ENV
chmod 600 .env
mkdir -p data/storage data/models

docker compose -f docker-compose.cpu.yml build
docker compose -f docker-compose.cpu.yml up -d

echo "==> Validando novo worker isolado"
healthy=0
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$BIND_PORT/v1/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 3
done
[[ "$healthy" == 1 ]] || { docker compose -f docker-compose.cpu.yml logs --tail 100; exit 4; }

install -d -m 755 /etc/caddy/conf.d
sed \
  -e "s/{\$CLEANER_PUBLIC_HOST}/$PUBLIC_HOST/g" \
  -e "s/{\$CLEANER_MAX_UPLOAD_GB}/2/g" \
  -e "s/127.0.0.1:8095/127.0.0.1:$BIND_PORT/g" \
  Caddyfile.cleaner > /etc/caddy/conf.d/cleaner.caddy

if ! grep -Fq 'import /etc/caddy/conf.d/*.caddy' /etc/caddy/Caddyfile; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.backup.$(date +%s)"
  printf '\nimport /etc/caddy/conf.d/*.caddy\n' >> /etc/caddy/Caddyfile
fi
caddy fmt --overwrite /etc/caddy/conf.d/cleaner.caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy

# The old CleanerIA was publicly mapped to 8095. It is stopped only after the
# new release and HTTPS proxy pass their health checks.
if [[ "$BIND_PORT" != "8095" ]]; then
  for container in $(docker ps --filter publish=8095 -q); do
    docker stop "$container"
  done
fi

curl -fsS "https://$PUBLIC_HOST/v1/health" >/dev/null
echo "==> Deploy concluido em https://$PUBLIC_HOST"
echo "==> Configure no app: CLEANER_WORKER_URL, CLEANER_WORKER_PUBLIC_URL e o segredo preservado em $REMOTE_DIR/.env"
REMOTE
