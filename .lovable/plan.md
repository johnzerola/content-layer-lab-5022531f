# O que falta hoje no VaiViral

Panorama depois de olhar o código: as ferramentas (ViralBatch, CorteIA, LimpaVídeo, Legendas, Monitora Live, Agenda) já funcionam bem isoladamente. O que falta é a camada de "produto": nada sobrevive a um F5, não existe plano/cobrança, e a fila roda só enquanto a aba está aberta.

## Lacunas encontradas

**1. Perda de trabalho ao recarregar (mais crítico)**
A lista de vídeos e a fila vivem só na memória da página (`src/routes/index.tsx`, `src/lib/jobs.ts` — nenhuma persistência local). Fechou a aba, perdeu o lote inteiro: arquivos importados, cortes gerados, edições e resultados prontos. Já existem tabelas `projects`/`batches` na nuvem, mas não há salvamento automático nem retomada.

**2. Sem plano, limite ou cobrança**
Existe página de vendas (`/vendas`) com preços, mas não existe assinatura, contador de uso, nem bloqueio por limite. Qualquer conta usa GPU e exportação à vontade — inviável cobrar assim.

**3. Sem histórico de trabalhos**
Não há uma tela "meus vídeos/meus jobs" com o que foi processado, quando, quanto tempo levou e link para baixar de novo. Hoje o download só existe no instante em que termina.

**4. Processamento preso ao navegador**
Cortes, legendas e exportação MP4 rodam na aba. Lote grande = máquina travada por horas e nada continua se o usuário fecha. Só o LimpaVídeo (GPU) roda fora.

**5. Onboarding inexistente**
Ao entrar, a tela pede que a pessoa já saiba o que é template, anti-duplicidade e score. Falta um primeiro caminho guiado ("cole um link → escolha o estilo → baixe 10 cortes").

**6. Ferramentas ainda pouco conectadas**
Existe handoff, mas não um fluxo natural do tipo "limpou a marca d'água → mandar para cortes → legendar → exportar" em um clique só.

## Onde eu começaria (ordem sugerida)

1. **Autosave + retomar sessão** — salvar o lote (itens, cortes, edições, status) e recarregar automaticamente ao voltar. Resolve a dor mais concreta.
2. **Biblioteca de resultados** — página com tudo já processado e download novamente.
3. **Planos e limites** — assinatura, contagem de minutos/exportações, bloqueio suave com aviso.
4. **Fila que continua fora da aba** — mover exportação pesada para o worker GPU já existente.
5. **Onboarding em 3 passos** na primeira visita.

## Detalhes técnicos

- Autosave: gravar snapshot do estado de `Home` (itens sem os arquivos binários + preEdit/clip/captions) em IndexedDB para os arquivos e em `projects` (Supabase) para os metadados, com debounce; ao montar, oferecer "retomar lote anterior".
- Biblioteca: usar a tabela `exports` já existente + Storage bucket para os MP4 finais, com expiração.
- Planos: tabela `subscriptions` + `usage_events`, checagem em server function antes de disparar job GPU/exportação; integração de pagamento a definir.
- Fila fora da aba: estender o worker do CleanerIA para aceitar jobs de render/legenda, reaproveitando o callback em `src/routes/api/public/cleaner-callback.ts`.
