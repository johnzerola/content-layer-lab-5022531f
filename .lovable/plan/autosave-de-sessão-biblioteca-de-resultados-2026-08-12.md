# Autosave de sessão + Biblioteca de resultados

Duas entregas: (1) o lote nunca mais se perde ao recarregar ou fechar a aba; (2) uma página com tudo que já foi gerado, para baixar de novo quando quiser.

## 1. Autosave e retomada do lote

Hoje a lista de vídeos, cortes, edições e status vive só na memória da página — um F5 apaga tudo. O registro na nuvem (`projects`) já existe, mas não guarda os arquivos de vídeo e não é acionado sozinho.

O que muda:

- **Salvamento contínuo, sem clicar em nada.** A cada mudança relevante (importar vídeo, gerar cortes, editar no Estúdio, terminar um render) o lote é gravado em segundo plano, com espera curta para não pesar.
- **O que é guardado:** os arquivos de vídeo importados, os cortes gerados (início/fim, score, título), as edições do Estúdio (crop, cor, legendas, anti-duplicidade), o template em uso, o status de cada item e os MP4 já prontos.
- **Retomada ao voltar:** ao abrir a ferramenta, se houver sessão anterior, aparece uma faixa no topo: "Você tem um lote de 34 vídeos de ontem às 20:12 — Retomar / Começar novo". Retomar recoloca a lista exatamente como estava, com os prontos já baixáveis.
- **Aviso ao sair no meio:** se houver render em andamento, o navegador pergunta antes de fechar.
- **Sessão por ferramenta:** ViralBatch, CorteIA e LimpaVídeo mantêm lotes separados, cada um retoma o seu.
- **Controle de espaço:** um botão "Descartar sessão" limpa tudo, e sessões com mais de 7 dias são apagadas sozinhas para não encher o disco.

## 2. Biblioteca de resultados

Nova página **Biblioteca** no menu, listando tudo que já foi exportado.

- Grade com miniatura, nome do arquivo, ferramenta de origem, duração, tamanho e data.
- Filtros por ferramenta (cortes, lote, limpeza) e busca por nome.
- Ações: baixar de novo, baixar vários em ZIP, mandar de volta para o Estúdio para reeditar, e apagar.
- Itens gerados no navegador ficam disponíveis enquanto estiverem na sessão local; itens processados na GPU e os que forem enviados para a nuvem ficam disponíveis de qualquer dispositivo, com aviso de expiração.
- Estado vazio explicando como gerar o primeiro vídeo.

## Detalhes técnicos

- **Persistência local:** novo `src/lib/session.ts` usando IndexedDB (sem dependência nova, API nativa) com duas stores — `blobs` (File/Blob dos vídeos e dos resultados) e `sessions` (snapshot serializável dos itens, referenciando blobs por chave). Debounce de ~1,5s, gravação também no `visibilitychange`.
- **Snapshot:** reaproveitar/estender `ProjectSnapshot` em `src/lib/cloud.ts` (adicionar `preEdit`, `status`, `clipTitle`, `resultKey`); espelhar os metadados em `projects` via `saveProject(mode, "sessão", snap)` quando houver login, para retomar em outro dispositivo (sem os binários).
- **Retomada:** hook `useSessionRestore(mode)` chamado no `Home` de `src/routes/index.tsx`; a faixa de retomada é um componente próprio, sem restaurar automaticamente para não sobrescrever um lote novo.
- **Biblioteca:** nova rota `src/routes/biblioteca.tsx` com `head()` próprio, unindo três fontes — resultados locais do IndexedDB, linhas de `exports` (histórico já registrado por `logExports`) e `cleaner_jobs` com `result_url`. Sem migração de banco nesta etapa; o upload opcional dos MP4 para Storage entra depois, se você quiser download entre dispositivos.
- **Reeditar:** reutilizar o `handoff` existente (`src/lib/handoff.ts`) para mandar um item da Biblioteca para o Estúdio.
