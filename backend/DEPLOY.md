# Subir o worker GPU do CleanerIA (passo a passo)

Sem esse worker, a rota `/limpar-ia` fica "offline" e a remoção de legenda
dinâmica não acontece — só resta o modo leve do navegador, que falha com
legenda karaokê.

Escolha um provedor com GPU NVIDIA (mínimo 16 GB de VRAM para ProPainter;
24 GB recomendado para 1080p).

## Opção A — RunPod (mais simples)

1. Crie a conta em runpod.io e vá em **Pods → Deploy**.
2. GPU: RTX 4090 ou A5000. Template: **RunPod PyTorch 2.x (CUDA 12)**.
3. Em *Expose HTTP Ports* coloque `8000`. Disco: 60 GB.
4. Abra o terminal do pod e rode:

```bash
apt-get update && apt-get install -y ffmpeg git redis-server
git clone <URL_DO_SEU_REPO> app && cd app/backend
pip install -r requirements.txt
python scripts/download_weights.py --all      # baixa ProPainter/STTN/LaMa
export CLEANER_WORKER_SECRET="<gere-uma-senha-longa>"
export USE_CELERY=0                            # começa sem fila
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

5. Teste: abra `https://<pod-id>-8000.proxy.runpod.net/v1/health` — deve
   responder com a GPU e a lista de engines.

Com fila (recomendado para vários jobs ao mesmo tempo):

```bash
redis-server --daemonize yes
export USE_CELERY=1 REDIS_URL=redis://localhost:6379/0
celery -A app.workers.tasks.celery_app worker --loglevel=info --concurrency=1 &
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Opção B — Docker em qualquer VPS com GPU

```bash
cd backend
docker build -t cleaner-worker .
docker run --gpus all -p 8000:8000 \
  -e CLEANER_WORKER_SECRET="<mesma-senha>" \
  -v $PWD/models:/app/models \
  cleaner-worker
```

## Conectar no app

Depois que `/v1/health` responder, me passe a URL pública e eu configuro:

- `CLEANER_WORKER_URL` = `https://<sua-url>` (sem barra no fim)
- `CLEANER_WORKER_SECRET` = a mesma senha do worker
- `VITE_VIDEO_CLEANER_API_URL` = a mesma URL

O worker manda o progresso de volta em
`POST {PUBLIC_SITE_URL}/api/public/cleaner-callback`, assinado com HMAC-SHA256
no header `x-signature`.

## Custo aproximado

RTX 4090 sob demanda custa cerca de US$ 0,40–0,70 por hora. Um vídeo vertical
de 1 minuto em 1080p leva de 2 a 6 minutos no preset `quality`. Desligue o pod
quando não estiver usando.
