# AI Video Cleaner - Worker GPU

Este é o motor de processamento pesado do SaaS. Ele recebe vídeos, detecta objetos/legendas e reconstrói o fundo usando IA (ProPainter).

## Estrutura

- `app/main.py`: API FastAPI para comunicação com o frontend Lovable.
- `app/engines/`: Implementações dos modelos de IA (ProPainter, STTN).
- `app/workers/`: Fila de processamento assíncrono com Celery.
- `models/`: Pasta para os pesos dos modelos (.pth).

## Como Executar (Local/Servidor GPU)

### 1. Requisitos
- Python 3.10+
- NVIDIA GPU + CUDA (Opcional, mas recomendado para ProPainter)
- Redis (para a fila Celery)

### 2. Instalação
```bash
cd backend
python -m venv venv
source venv/bin/activate  # ou venv\Scripts\activate no Windows
pip install -r requirements.txt
```

### 4. Executar API
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 5. Executar Worker (em outro terminal)
```bash
celery -A app.workers.tasks worker --loglevel=info
```

## Integração com Lovable

No seu projeto Lovable, configure a variável de ambiente:
`VITE_VIDEO_CLEANER_API_URL="http://ip-do-servidor:8000"`

A chave `CLEANER_WORKER_SECRET` deve ser a mesma no Lovable (Secrets) e no Worker.
