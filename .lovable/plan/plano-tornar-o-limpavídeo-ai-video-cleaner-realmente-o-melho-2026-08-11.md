# Plano: tornar o LimpaVídeo/AI Video Cleaner realmente "o melhor"

## Estado atual (confirmado no código)

O sistema já funciona de ponta a ponta:

- Frontend real em `CleanerIAStudio.tsx`: upload com progresso, detecção automática, editor de máscaras, timeline de `from/to`, before/after com o MP4 processado vindo do worker.
- Backend Python real (`backend/app/main.py`, `workers/tasks.py`): detecção de cenas, detecção de texto/marca d'água, refino de máscara, estabilização por optical flow, inpainting em janelas, consistência temporal, segundo passe automático e mux de áudio via FFmpeg.
- Contrato HMAC assinado entre frontend, server functions e worker.

## Gaps críticos encontrados

1. **Conteúdo estranho/injetado no UI**: `CleanerIAStudio.tsx:253` renderiza um bloco de texto que parece prompt-injection como descrição do modo "smart". Isso é um defeito real e precisa ser removido.
2. **Ferramentas de máscara incompletas**: só existem retângulo, protect, erase e select. Faltam polígono, smart brush/freehand — o tipo `CleanerRegion` já prevê, mas a UI não cria.
3. **Dockerfile vazio**: `backend/Dockerfile` tem 0 bytes. Impossível deployar o worker em GPU de forma reprodutível.
4. **Pesos de modelos não vendidos**: ProPainter, STTN e LaMa exigem pesos externos. Sem eles o engine silenciosamente cai para `TemporalFillEngine` (método clássico, não neural). Não há garantia de qualidade ProPainter no deploy.
5. **Adapters prometidos e não implementados**: E2FGVI e DiffuEraser são mencionados no spec anterior, mas não existem em `backend/app/engines/inpainting.py`.
6. **Rota dedicada ausente**: não existe `src/routes/limpar-ia.tsx`; a ferramenta vive como modo dentro do app shell.
7. **Métricas fantasmas**: `CleanerMetrics` define campos (coverage, edge residue, flicker, confidence) que o backend nunca retorna.
8. **Código morto**: `src/lib/inpaint.ts` (Telea FMM client-side) não é importado por ninguém.

## O que o plano vai entregar

1. **Limpar o UI**: remover o texto injetado e reescrever a descrição do modo smart de forma profissional.
2. **Completar o editor de máscaras**: adicionar ferramentas de polígono e smart brush/freehand no `CleanerIAStudio.tsx`, com keyframes de forma por tempo (não só visibilidade from/to).
3. **Dockerfile funcional**: criar `backend/Dockerfile` multi-stage com CUDA/PyTorch, FFmpeg, PaddleOCR e instalação dos requirements; expor porta 8000 e rodar `main.py`.
4. **Documentar e validar pesos**: adicionar `backend/scripts/download_weights.py` e atualizar `README.md` com URLs/instruções oficiais; garantir que o worker falhe explicitamente (não silenciosamente) quando pesos estiverem ausentes, ou ao menos logue o fallback.
5. **Adapters extras (opcional, mas alinha com o spec)**: implementar `E2FGVIEngine` e `DiffuEraserEngine` em `inpainting.py`, ou remover as menções se decidirmos não suportar.
6. **Rota dedicada**: criar `src/routes/limpar-ia.tsx` com head() próprio e mover/duplicar o mount do `CleanerIAStudio` para ela; manter compatibilidade com o modo atual se necessário.
7. **Métricas reais**: ajustar `CleanerMetrics` para refletir apenas o que `tasks.py` retorna, ou fazer o backend retornar as métricas prometidas.
8. **Remover código morto**: deletar `src/lib/inpaint.ts` ou mover para um arquivo de fallback documentado.

## Critério de sucesso

- Usuário consegue subir o worker com `docker build` + `docker run` numa GPU.
- Editor de máscaras permite polígono e brush livre, além de retângulo.
- Before/after continua funcionando com MP4 real processado.
- Nenhum texto estranho aparece na interface.
- A rota `/limpar-ia` existe e é acessível pelo menu lateral.

## Notas técnicas

- Não vamos tocar em `src/integrations/supabase/client.ts` nem em schemas `auth/storage`.
- Pesos de modelos não serão commitados no repo; apenas scripts e documentação.
- Manteremos o fallback `TemporalFillEngine` como opção "rápida", mas com log claro de qual engine foi usada.