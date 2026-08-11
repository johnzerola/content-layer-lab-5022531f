# AI Video Cleaner — worker GPU

Backend Python que remove legendas, textos, logos e marcas d'água **reconstruindo
o fundo** com inpainting temporal. Nunca usa blur, mosaico, overlay ou crop.

## Pipeline

```
vídeo → scene detection → text detection (DBNet/PaddleOCR)
     → mask generation → mask refinement → temporal tracking (optical flow)
     → video inpainting (ProPainter / STTN / LaMa) em janelas com overlap
     → validação de consistência temporal → encoding FFmpeg → resultado
```

## Arquivos

| Arquivo | Função |
| --- | --- |
| `app/main.py` | API FastAPI (upload, detect, process, status, cancel, result) |
| `app/workers/tasks.py` | Pipeline completa + task Celery + detecção automática |
| `app/engines/inpainting.py` | `InpaintingEngine`, ProPainter, STTN, LaMa, TemporalFill, janelas + OOM |
| `app/services/scene.py` | Cortes de cena por histograma |
| `app/services/text_detect.py` | Caixas de texto + máscara de pixel (letra, stroke, sombra, glow) |
| `app/services/mask.py` | Regiões → máscara binária, `protect`, refino, limite por cena |
| `app/services/tracking.py` | Propagação por optical flow, estabilização, regiões estáticas |
| `app/services/watermark.py` | Watermark fixa/móvel, logo, username |
| `app/utils/video.py` | ffprobe, leitura de frames, encoder raw→x264, mux de áudio |

## Instalação

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# ffmpeg e ffprobe precisam estar no PATH
```

## Pesos dos modelos

Baixe automaticamente:

```bash
python scripts/download_weights.py --all
```

Ou manualmente para `backend/models/`:

- **ProPainter** — `ProPainter.pth` do repositório oficial `sczhou/ProPainter`
  (release "weights"). Também é preciso o pacote `model/` do ProPainter no
  `PYTHONPATH` para o import `model.propainter`.
- **STTN** — `sttn.pth` do repositório `researchmm/STTN`.
- **LaMa** — `big-lama.pt` (TorchScript) do `advimman/lama`.
- **E2FGVI** — `e2fgvi.pth` do repositório `MCG-NJU/E2FGVI`.
- **DiffuEraser** — `diffueraser.pt` do repositório `L-YeZ/DiffuEraser`.

Sem pesos, o motor cai em `TemporalFillEngine`: reconstrução real do fundo
buscando o pixel em frames vizinhos com alinhamento por optical flow (sem blur).
O worker loga explicitamente qual engine efetivamente rodou.

## Variáveis de ambiente

| Variável | Descrição |
| --- | --- |
| `CLEANER_WORKER_SECRET` | Mesmo segredo configurado no app Lovable (HMAC) |
| `CLEANER_STORAGE` | Pasta de armazenamento (padrão `storage`) |
| `REDIS_URL` | Broker/backend Celery (`redis://localhost:6379/0`) |
| `USE_CELERY` | `1` para usar a fila Celery; `0` roda em background do FastAPI |
| `PROPAINTER_WEIGHTS` / `STTN_WEIGHTS` / `LAMA_WEIGHTS` | Caminhos dos pesos |
| `CORS_ORIGINS` | Origens permitidas (padrão `*`) |

## Executar

```bash
# 1) Redis
docker run -p 6379:6379 redis:7-alpine

# 2) API
uvicorn app.main:app --host 0.0.0.0 --port 8000

# 3) Worker Celery (com USE_CELERY=1)
celery -A app.workers.tasks.celery_app worker --loglevel=info --concurrency=1
```

CUDA: `torch.cuda.is_available()` é checado em runtime; FP16 é ligado
automaticamente na GPU e OOM reduz o chunk pela metade e tenta novamente.

## Conectar ao app

No projeto Lovable defina:

- `CLEANER_WORKER_URL` = `https://seu-worker:8000`
- `CLEANER_WORKER_SECRET` = mesmo segredo do worker
- `VITE_VIDEO_CLEANER_API_URL` = mesma URL (chamadas diretas do browser)

O worker envia progresso para `POST {PUBLIC_SITE_URL}/api/public/cleaner-callback`
assinado com HMAC-SHA256 no header `x-signature`.

## Endpoints

```
GET  /v1/health
POST /v1/jobs/{id}/upload     (multipart, header x-job-token)
POST /v1/jobs/{id}/detect     { mode, roi }
POST /v1/jobs/{id}/process    { mode, preset, masks, options, callbackUrl }
GET  /v1/jobs/{id}
POST /v1/jobs/{id}/cancel
GET  /v1/jobs/{id}/result     (MP4 final)
```

Presets: `fast` (STTN) · `quality` (ProPainter) · `max` (ProPainter contexto
maior + segundo passe).

## v2 — legenda dinâmica, sem borrão

- Máscara por frame: em modos `subtitle` / `text` / `smart`, o detector roda em
  frames-chave (`options.key_step`, padrão 3) e a máscara é transportada entre
  eles por optical flow. Legenda karaokê que muda palavra a palavra é
  acompanhada.
- Proteção de sujeito: `options.protect_subject` (padrão `true`) subtrai
  rosto/pessoa da máscara. Usa mediapipe quando instalado, senão Haar cascade.
- Anti-borrão: nenhum resultado final sai de difusão. Ordem: reconstrução
  temporal real → motor neural → síntese por casamento de trechos
  (`patch_fill`).
- Verificação automática: `options.verify` (padrão `true`) mede texto residual
  (OCR), nitidez da área reconstruída versus o entorno e consistência temporal;
  trechos reprovados são reprocessados com máscara ampliada.
- Streaming: janelas com contexto, sem carregar o vídeo inteiro na memória, e
  sem atravessar corte de cena.
- A resposta traz `segments[]` com métricas por trecho, além de `metrics`.

Opcional: `pip install mediapipe` melhora a proteção de pessoa.
