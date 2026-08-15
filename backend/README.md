# CleanerIA Worker 2.1

Worker FastAPI para remover legendas, textos, logos, marcas d'agua e objetos de
videos. O pipeline preserva resolucao, FPS e audio e oferece tres niveis:

- `fast`: preenchimento temporal classico;
- `quality`: ProPainter oficial completo, incluindo RAFT e flow completion;
- `max`: DiffuEraser oficial com prior temporal do ProPainter.

## Seguranca

- tokens HMAC `v2` vinculados ao UUID, escopo e expiracao;
- escopos independentes `upload`, `control` e `result`;
- downloads assinados e com expiracao;
- callbacks assinados com timestamp, sequencia antirreplay e origem HTTPS exata;
- protecao SSRF por allowlist e rejeicao de DNS privado;
- CORS e hosts explicitamente permitidos;
- Swagger desativado em producao;
- limite por IP e cabecalhos de seguranca;
- segredo fraco impede a inicializacao em producao.

## Arquivos e quota

O upload e gravado em arquivo temporario, medido durante o streaming e validado
com `ffprobe`. Arquivos vazios, formatos invalidos, duracao, FPS ou resolucao
acima dos limites sao removidos. Cada arquivo recebe um SHA-256 (`file_id`).

O worker reserva espaco livre, aplica uma quota total e remove jobs encerrados
apos a retencao configurada. Estado e progresso tambem ficam em `state.json`,
permitindo recuperacao depois de reiniciar o processo.

## Importacao por link

`POST /v1/media/resolve` usa `yt-dlp` fixado e atualizado para resolver posts
publicos de TikTok, Instagram, YouTube, Facebook, X, Reddit, Vimeo, Streamable,
Pinterest, Kwai e Dailymotion. A rota exige token HMAC de servico, recusa DRM,
lives, playlists e DNS privado, e nunca devolve cookies ao navegador.

Quando a plataforma oferece um MP4 original sem sobreposicao, essa versao e
priorizada. Isso nao remove uma marca que ja esteja gravada nos pixels; nesse
caso o arquivo pode seguir para o CleanerIA. Para plataformas que separam audio
e video, configure uma instancia Cobalt propria em `COBALT_API_URL`; ela tem
prioridade e entrega o arquivo remuxado. Instancias publicas de terceiros nao
devem ser usadas como backend sem permissao do operador.

Use `CLEANER_YTDLP_COOKIES_FILE` somente para cookies de uma conta propria e
autorizada. Conteudo privado ou protegido continua bloqueado pelo produto.

Tambem existe um agente CLI para baixar o melhor arquivo publico/autorizado em
uma pasta local da VPS:

```bash
python scripts/download_media_agent.py "https://www.tiktok.com/@perfil/video/123" --out downloads
python scripts/download_media_agent.py "https://www.youtube.com/watch?v=..." --probe
```

Ele tenta pegar a versao original disponibilizada pela plataforma/extrator. Nao
burla DRM, conta privada, paywall, nem remove marca d'agua que ja esteja gravada
nos pixels; nesses casos use somente conteudo proprio/autorizado e, se precisar,
mande o arquivo para o CleanerIA.

## Desenvolvimento

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements-cpu.txt
uvicorn app.main:app --reload
python -m unittest discover -s tests -v
```

Consulte [DEPLOY.md](DEPLOY.md) e [.env.example](.env.example) para producao.
