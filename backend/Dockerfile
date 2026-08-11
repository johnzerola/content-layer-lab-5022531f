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
    CLEANER_STORAGE=/app/storage

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.10 python3-pip python3.10-venv \
    ffmpeg ffprobe \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender-dev libgomp1 \
    git wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala dependências Python primeiro (camada cacheável)
COPY requirements.txt .
RUN python3.10 -m pip install --upgrade pip setuptools wheel && \
    python3.10 -m pip install -r requirements.txt

# Copia o código da aplicação
COPY app/ ./app/
COPY scripts/ ./scripts/

# Cria pastas de trabalho
RUN mkdir -p /app/storage /app/models

EXPOSE 8000

# Healthcheck simples
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python3.10 -c "import requests; requests.get('http://localhost:8000/v1/health', timeout=5)" || exit 1

CMD ["python3.10", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
