# AI Video Cleaner — GPU worker
# Build: docker build -t cleaner-worker .
# Run:   docker run --gpus all -p 8000:8000 \
#          -e CLEANER_WORKER_SECRET=<segredo> \
#          -e REDIS_URL=redis://host:6379/0 \
#          -v /path/to/weights:/app/models \
#          cleaner-worker

FROM nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TORCH_CUDA_ARCH_LIST="7.0 7.5 8.0 8.6 8.9 9.0" \
    CLEANER_STORAGE=/app/storage \
    PROPAINTER_ROOT=/opt/ProPainter \
    PROPAINTER_WEIGHTS_DIR=/app/models \
    DIFFUERASER_ROOT=/opt/DiffuEraser \
    DIFFUERASER_MODELS_ROOT=/app/max-models \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_HOME=/tmp/huggingface

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3-pip python3.10-venv \
    ffmpeg tini \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1 \
    git wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala dependências Python primeiro (camada cacheável)
COPY requirements.txt .
RUN python3.10 -m pip install --upgrade pip setuptools wheel && \
    python3.10 -m pip install -r requirements.txt

# Complete upstream implementation. Runtime weights stay in a mounted volume.
ARG PROPAINTER_COMMIT=e870e79321c31b733e2031af5aa2fb1fe3ac7eec
RUN git clone --no-checkout https://github.com/sczhou/ProPainter.git /opt/ProPainter && \
    cd /opt/ProPainter && git checkout ${PROPAINTER_COMMIT}

ARG DIFFUERASER_COMMIT=8e6f279ac7531e27ad1849c6f8dab5372a8597e7
RUN git clone --no-checkout https://github.com/lixiaowen-xw/DiffuEraser.git /opt/DiffuEraser && \
    cd /opt/DiffuEraser && git checkout ${DIFFUERASER_COMMIT}

# Copia o código da aplicação
COPY app/ ./app/
COPY scripts/ ./scripts/

# Cria pastas de trabalho
RUN mkdir -p /app/storage /app/models /app/max-models && \
    useradd -m -u 10001 cleaner && \
    chown -R cleaner:cleaner /app /opt/ProPainter /opt/DiffuEraser

USER cleaner

EXPOSE 8000

# Healthcheck simples
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python3.10 -c "import requests; requests.get('http://localhost:8000/v1/health', timeout=5)" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python3.10", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
