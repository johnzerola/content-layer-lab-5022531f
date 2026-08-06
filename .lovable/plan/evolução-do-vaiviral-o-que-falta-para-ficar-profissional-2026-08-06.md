# Evolução do VaiViral — o que falta para ficar profissional

Análise do estado atual: o produto já cobre o fluxo completo (template → importar → variações → legendas → limpeza → exportar MP4/ZIP), mas tem quatro fragilidades claras: **tudo roda na thread principal**, **nada é salvo na nuvem**, **a tela principal virou um arquivo de 1.864 linhas** e **não há nenhuma verificação automática de que a exportação continua funcionando**.

## Prioridade 1 — Performance real (o que mais trava hoje)

- Mover o inpaint (reconstrução) e a detecção de overlays para um **Web Worker** com `OffscreenCanvas`, para a interface não congelar durante limpeza e preview.
- Fila de exportação com **concorrência controlada** (1–2 vídeos por vez) em vez de sequencial cego, com barra de progresso por vídeo/variação e botão de cancelar.
- Cache do resultado do inpaint para regiões estáticas: hoje a mesma área é reconstruída do zero a cada quadro; reaproveitar quando o fundo não muda corta a maior parte do custo.

## Prioridade 2 — Persistência na nuvem (Lovable Cloud)

Hoje os templates vivem só no `localStorage` — trocar de navegador perde tudo.

- Login e biblioteca de templates por usuário, com versões/histórico já existentes migrados.
- Histórico de lotes processados (quais vídeos, quais presets, quando).
- Presets de legenda e de limpeza compartilháveis por link.

## Prioridade 3 — Confiabilidade da exportação

- Checagem de codec **antes** de processar o lote, avisando de forma clara quando cair em WebM em vez de MP4.
- Retentativa automática por vídeo que falhar, sem derrubar o lote inteiro.
- Relatório final do lote: quantos exportados, quais falharam e por quê.
- Testes automatizados dos módulos puros (`clips`, `variation`, `captions`, `template`, `inpaint`) para não quebrar em silêncio.

## Prioridade 4 — Produto e UX

- Quebrar a tela principal em painéis por modo (Lote / Só cortes / Limpar), cada um com seu próprio arquivo — hoje tudo está misturado.
- Onboarding curto no primeiro acesso mostrando o fluxo em 4 passos.
- Atalhos de teclado no editor (setas, duplicar, deletar, desfazer) e estados vazios bem desenhados.
- Métricas de tempo estimado de processamento antes de iniciar o lote.

## Notas técnicas

- Worker: `src/workers/inpaint.worker.ts` com transferência de `ImageData` por buffer transferível; `draw.ts` passa a chamar de forma assíncrona no preview e síncrona (bloqueante em worker) na exportação HQ.
- Cloud: tabelas `templates`, `template_versions`, `batches` com RLS por `auth.uid()` e GRANTs explícitos; migração automática do que estiver no `localStorage` no primeiro login.
- Refatoração: extrair de `src/routes/index.tsx` os componentes `BatchPanel`, `ClipPanel`, `CleanupPanel` e o hook `useBatchQueue`, mantendo o comportamento atual.
- Testes com Vitest sobre funções puras, sem depender de canvas.

## Sugestão de execução

Fazer na ordem 1 → 2 → 3 → 4. A Prioridade 1 sozinha já resolve a maior parte das queixas de travamento.
