# LimpaVídeo: detecção automática de verdade

Hoje a detecção existe, mas só roda quando você clica em "detectar automático", só analisa o vídeo selecionado, e as áreas encontradas só são usadas se você clicar em cada sugestão. Além disso o detector atual olha só 8 quadros e procura "muita borda + pouco movimento", então falha em: legendas que aparecem/somem, marcas d'água semitransparentes, logos/imagens (sem borda de texto) e textos que mudam de conteúdo no mesmo lugar.

## O que muda

1. **Detecção automática ao importar**
   - Assim que os vídeos entram na fila do LimpaVídeo, cada arquivo é analisado em segundo plano (fila com limite de concorrência) e recebe suas próprias áreas detectadas.
   - Cada item da fila mostra um selo: "3 áreas detectadas", "analisando…" ou "nada encontrado".

2. **Áreas por vídeo, aplicadas no processamento**
   - As regiões deixam de ser só sugestão global: ficam salvas no item e são usadas automaticamente no export em lote, sem clique.
   - Você continua podendo editar/remover/adicionar áreas de qualquer vídeo, e há um botão "aplicar estas áreas em todos" quando o lote é do mesmo canal.

3. **Detector mais forte (3 sinais em vez de 1)**
   - **Texto/legenda:** mapa de bordas com mais quadros amostrados (16–24) e medida de "quantos quadros a célula teve texto" — pega legenda intermitente, que hoje é descartada por movimento.
   - **Marca d'água fixa:** média temporal dos quadros; pixels que quase não mudam ao longo do vídeo revelam o logo mesmo transparente (mediana + variância baixa).
   - **Logo/imagem:** blobs de cor consistente e baixa variância nos cantos, sem exigir bordas de texto.
   - Junta os três mapas, agrupa em retângulos, remove sobreposições e classifica em Legenda queimada / Marca d'água / Logo / Texto sobreposto.

4. **Faixas conhecidas como rede de segurança**
   - Se nada for detectado, sugerimos as zonas típicas (rodapé de legenda, canto superior direito) marcadas como "sugestão", para você aceitar com um clique em vez de desenhar do zero.

5. **Feedback claro**
   - Painel do LimpaVídeo mostra miniatura do quadro com os retângulos detectados e o comparativo antes/depois já com o inpaint aplicado nessas áreas.

## Detalhes técnicos

- `src/lib/detect.ts`: reescrito para retornar `{regions, debug}` combinando mapa de bordas temporal, mapa de estabilidade (mediana/variância por pixel em baixa resolução) e detecção de blob de cor; mais quadros amostrados com seek assíncrono e `AbortSignal`.
- `src/routes/index.tsx`: novo estado `detectQueue` para LimpaVídeo — dispara `detectOverlays` ao adicionar itens (concorrência 2), grava `item.regions`, e o pipeline de render passa a usar `item.regions ?? regiões do template`.
- `src/components/CleanupStudio.tsx`: lista de áreas por vídeo (editáveis), selo de status de análise, botão "aplicar em todos", fallback de zonas sugeridas.
- `src/components/ImportPanel.tsx`: no modo limpar, informa que a análise começa automaticamente.
- Sem mudança no motor de inpaint (`src/lib/inpaint.ts`) — só passa a receber as áreas certas automaticamente.
