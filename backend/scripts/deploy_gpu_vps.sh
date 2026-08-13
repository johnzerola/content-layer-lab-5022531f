#!/usr/bin/env bash
set -euo pipefail

REMOTE_DIR=${REMOTE_DIR:-/opt/cleaner-gpu}
HOST=${VPS_HOST:?defina VPS_HOST}
USER=${VPS_SSH_USER:-root}
APP_ORIGIN=${APP_ORIGIN:?defina APP_ORIGIN, por exemplo https://app.example.com}
PUBLIC_HOST=${CLEANER_PUBLIC_HOST:?defina CLEANER_PUBLIC_HOST}
BIND_PORT=${CLEANER_BIND_PORT:-8097}
MIN_VRAM_MB=${DIFFUERASER_MIN_VRAM_MB:-20000}

[[ "$APP_ORIGIN" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || { echo "APP_ORIGIN invalida"; exit 2; }
[[ "$PUBLIC_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || { echo "CLEANER_PUBLIC_HOST invalido"; exit 2; }
[[ "$BIND_PORT" =~ ^[0-9]+$ ]] || { echo "CLEANER_BIND_PORT invalida"; exit 2; }
[[ "$MIN_VRAM_MB" =~ ^[0-9]+$ ]] || { echo "DIFFUERASER_MIN_VRAM_MB invalida"; exit 2; }

echo "==> Enviando release GPU para $USER@$HOST:$REMOTE_DIR"
ssh "$USER@$HOST" "mkdir -p '$REMOTE_DIR'"
rsync -az --delete \
  --exclude data --exclude .env --exclude __pycache__ --exclude '*.pyc' \
  ./app ./scripts ./requirements.txt ./Dockerfile ./docker-compose.gpu.yml \
  ./Caddyfile.cleaner "$USER@$HOST:$REMOTE_DIR/"

ssh "$USER@$HOST" \
  "REMOTE_DIR='$REMOTE_DIR' APP_ORIGIN='$APP_ORIGIN' PUBLIC_HOST='$PUBLIC_HOST' BIND_PORT='$BIND_PORT' MIN_VRAM_MB='$MIN_VRAM_MB' bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"

for command in docker caddy nvidia-smi; do
  command -v "$command" >/dev/null 2>&1 || { echo "$command e obrigatorio"; exit 3; }
done
docker compose version >/dev/null 2>&1 || { echo "Docker Compose plugin e obrigatorio"; exit 3; }
docker info --format '{{json .Runtimes}}' | grep -q 'nvidia' || {
  echo "NVIDIA Container Toolkit nao esta configurado no Docker"
  exit 3
}

VRAM_MB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | sort -nr | head -n1 | tr -d ' ')
[[ "$VRAM_MB" =~ ^[0-9]+$ ]] || { echo "nao foi possivel ler a VRAM"; exit 3; }
if (( VRAM_MB < MIN_VRAM_MB )); then
  echo "GPU com ${VRAM_MB} MiB; DiffuEraser configurado exige ao menos ${MIN_VRAM_MB} MiB"
  exit 3
fi

AVAILABLE_KB=$(df -Pk "$REMOTE_DIR" | awk 'NR==2 {print $4}')
if (( AVAILABLE_KB < 70 * 1024 * 1024 )); then
  echo "sao necessarios ao menos 70 GB livres antes do download dos modelos"
  exit 3
fi

umask 077
SECRET=""
if [[ -f .env ]]; then
  SECRET=$(sed -n 's/^CLEANER_WORKER_SECRET=//p' .env | head -n1)
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
CLEANER_STORAGE_QUOTA_GB=100
CLEANER_MIN_FREE_GB=20
CLEANER_RETENTION_HOURS=72
CLEANER_RATE_LIMIT_PER_MINUTE=120
PROPAINTER_MAX_SIDE=1280
DIFFUERASER_MAX_SIDE=960
ENV
chmod 600 .env
install -d -m 750 -o 10001 -g 10001 data/storage data/models data/max-models

docker compose -f docker-compose.gpu.yml build

echo "==> Instalando snapshots imutaveis e pesos verificados"
docker compose -f docker-compose.gpu.yml run --rm --no-deps \
  worker python3.10 scripts/install_propainter.py --weights-only --weights-dir /app/models
docker compose -f docker-compose.gpu.yml run --rm --no-deps \
  -e HF_HUB_OFFLINE=0 -e TRANSFORMERS_OFFLINE=0 \
  worker python3.10 scripts/install_diffueraser.py --models-only --models-root /app/max-models

docker compose -f docker-compose.gpu.yml up -d

echo "==> Validando CUDA e os dois motores oficiais"
healthy=0
for _ in $(seq 1 120); do
  body=$(curl -fsS "http://127.0.0.1:$BIND_PORT/v1/health" 2>/dev/null || true)
  if grep -q '"ai_ready":true' <<<"$body" && grep -q '"max_ready":true' <<<"$body"; then
    healthy=1
    break
  fi
  sleep 3
done
[[ "$healthy" == 1 ]] || { docker compose -f docker-compose.gpu.yml logs --tail 150; exit 4; }

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

public_health=$(curl -fsS "https://$PUBLIC_HOST/v1/health")
grep -q '"max_ready":true' <<<"$public_health" || { echo "health publico nao confirmou DiffuEraser"; exit 4; }

for old_port in 8095 8096; do
  [[ "$old_port" == "$BIND_PORT" ]] && continue
  for container in $(docker ps --filter "publish=$old_port" -q); do
    docker stop "$container"
  done
done

echo "==> Deploy GPU concluido em https://$PUBLIC_HOST"
echo "==> O segredo permanece somente em $REMOTE_DIR/.env"
REMOTE
