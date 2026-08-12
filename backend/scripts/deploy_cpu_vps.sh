#!/usr/bin/env bash
# Sobe o sandbox CPU do CleanerIA em uma VPS, isolado em /opt/cleaner-cpu.
# NÃO toca em nenhum outro diretório/serviço existente.
#
# Uso local (a partir de backend/):
#   VPS_HOST=1.2.3.4 VPS_SSH_USER=root ./scripts/deploy_cpu_vps.sh
set -euo pipefail

REMOTE_DIR=${REMOTE_DIR:-/opt/cleaner-cpu}
HOST=${VPS_HOST:?defina VPS_HOST}
USER=${VPS_SSH_USER:-root}

echo "==> Enviando código para $USER@$HOST:$REMOTE_DIR"
ssh "$USER@$HOST" "mkdir -p $REMOTE_DIR"
rsync -az --delete \
  --exclude 'data' --exclude '__pycache__' --exclude '*.pyc' \
  ./app ./scripts ./requirements-cpu.txt ./Dockerfile.cpu ./docker-compose.cpu.yml \
  "$USER@$HOST:$REMOTE_DIR/"

ssh "$USER@$HOST" bash -s <<'REMOTE'
set -euo pipefail
cd /opt/cleaner-cpu

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Instalando Docker (engine + compose plugin)"
  curl -fsSL https://get.docker.com | sh
fi

if [ ! -f .env ]; then
  echo "CLEANER_WORKER_SECRET=$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)" > .env
  chmod 600 .env
fi

mkdir -p data/storage data/models
docker compose -f docker-compose.cpu.yml up -d --build

echo "==> Aguardando health"
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8095/v1/health >/dev/null 2>&1; then break; fi
  sleep 5
done
curl -sS http://127.0.0.1:8095/v1/health || true
echo
grep CLEANER_WORKER_SECRET .env
REMOTE

echo "==> Pronto. Worker em http://127.0.0.1:8095 (dentro da VPS)."
