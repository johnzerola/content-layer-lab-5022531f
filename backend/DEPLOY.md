# CleanerIA: deploy de producao

## Capacidade

O preset `fast` funciona em CPU. `quality` exige uma GPU NVIDIA e os tres
pesos oficiais do ProPainter. `max` exige GPU com mais VRAM e todos os modelos
do DiffuEraser. A API informa a capacidade real em `/v1/health`; a interface
nao oferece um preset cujo motor nao esteja pronto.

Recomendacao minima:

- ProPainter: NVIDIA com 24 GB de VRAM;
- DiffuEraser: NVIDIA com 40 GB de VRAM;
- 70 GB livres para imagem, modelos e arquivos temporarios;
- Docker Engine, Compose plugin, Caddy e NVIDIA Container Toolkit para GPU.

## Limites padrao

| Controle | Padrao |
| --- | ---: |
| arquivo | 2 GB |
| duracao | 3.600 segundos |
| resolucao | 3840x2160 |
| FPS | 60 |
| quota do worker CPU | 50 GB |
| espaco livre reservado | 10 GB |
| retencao dos arquivos | 72 horas |
| jobs pesados simultaneos | 1 |
| requisicoes por IP | 120/minuto |

Todos os valores sao configuraveis pelas variaveis documentadas em
`.env.example`. O limite e aplicado no navegador, no servidor do app, no Caddy
e novamente durante o streaming do arquivo no worker.

## Deploy CPU seguro

Execute a partir de `backend/` depois que o SSH por chave estiver funcionando:

```bash
VPS_HOST=104.234.186.50 \
APP_ORIGIN=https://seu-app.example \
CLEANER_PUBLIC_HOST=cleaner-104-234-186-50.nip.io \
bash scripts/deploy_cpu_vps.sh
```

O script:

1. preserva o segredo existente ou gera um segredo forte sem imprimi-lo;
2. sobe a nova versao em `127.0.0.1:8096`;
3. valida o health check antes da troca;
4. configura Caddy com HTTPS e limite de corpo;
5. fecha o container CleanerIA antigo publicado em `8095` somente apos sucesso.

## Modelos GPU

Deploy completo, com teste de GPU/VRAM, download pinado, health check e troca
atomica do proxy:

```bash
VPS_HOST=104.234.186.50 \
APP_ORIGIN=https://seu-app.example \
CLEANER_PUBLIC_HOST=cleaner-104-234-186-50.nip.io \
bash scripts/deploy_gpu_vps.sh
```

Para uma instalacao manual:

```bash
mkdir -p data/models data/max-models data/storage
python3 -m pip install "huggingface-hub==0.23.4"
python3 scripts/install_propainter.py --weights-only --weights-dir data/models
python3 scripts/install_diffueraser.py --models-only --models-root data/max-models
docker compose -f docker-compose.gpu.yml up -d --build
```

Nao habilite `quality` enquanto `ai_ready` for falso, nem `max` enquanto
`max_ready` for falso. O worker nao faz downgrade silencioso de qualidade.

## Variaveis do app

```env
CLEANER_WORKER_URL=https://cleaner-104-234-186-50.nip.io
CLEANER_WORKER_PUBLIC_URL=https://cleaner-104-234-186-50.nip.io
CLEANER_WORKER_SECRET=mesmo valor de backend/.env
PUBLIC_SITE_URL=https://seu-app.example
CLEANER_MAX_UPLOAD_GB=2
```

O segredo nunca recebe prefixo `VITE_`. O navegador recebe somente um token
temporario e restrito ao upload daquele UUID.

## Checklist

- `/docs` e `/openapi.json` retornam 404 em producao;
- portas do worker escutam somente em `127.0.0.1`;
- apenas `22`, `80` e `443` precisam estar publicas;
- download sem token ou com token de upload retorna 401;
- callback fora da origem permitida e recusado;
- `npm audit --omit=dev` retorna zero vulnerabilidades;
- a migracao Supabase mais recente foi aplicada;
- a senha root exposta anteriormente foi trocada e SSH usa chave.

O ProPainter usa a licenca NTU S-Lab 1.0, restrita a uso nao comercial sem
autorizacao adicional. Use a remocao somente em conteudo proprio ou autorizado.
