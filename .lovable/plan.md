# Editor de vídeo profissional — nova experiência

O Estúdio de edição hoje é uma janela única com nove abas em fila, um preview do vídeo original (não do resultado 9:16) e a timeline embaixo. Funciona, mas parece um painel de opções, não um editor. O plano é reorganizar tudo em um layout de editor profissional, mantendo todas as funções que já existem (cortar, layout, enquadrar, câmera dinâmica, keyframes, transições, cor, legenda, textos).

## 1. Nova estrutura de tela

```text
┌──────────────────────────────────────────────────────────────┐
│  arquivo · 1080x1920 · 0:32     [desfazer][refazer]  [Aplicar]│
├────────┬──────────────────────────────┬──────────────────────┤
│ trilha │        PALCO                 │   INSPETOR           │
│ de     │  [ Fonte | Saída 9:16 ]      │   (só a ferramenta   │
│ ferra- │   preview em tempo real      │    selecionada)      │
│ mentas │   ⏯  0:04.2 / 0:32  1x       │                      │
├────────┴──────────────────────────────┴──────────────────────┤
│  TIMELINE: filmstrip · onda · segmentos · keyframes · legenda │
└──────────────────────────────────────────────────────────────┘
```

- **Barra lateral de ferramentas** (ícone + rótulo, vertical) no lugar da fileira de 9 abas apertadas, agrupada em: Tempo (Cortar, Transições), Imagem (Layout, Enquadrar, Câmera, Keyframes, Cor), Conteúdo (Legenda, Textos).
- **Inspetor à direita**: só os controles da ferramenta ativa, com seções recolhíveis e valores numéricos editáveis ao lado de cada slider (hoje só dá pra arrastar).
- **Câmera (enquadramento dinâmico)** deixa de esconder a tela inteira e passa a ser mais uma ferramenta dentro do mesmo layout, com o palco compartilhado.

## 2. Preview em tempo real do resultado

Hoje o palco mostra o vídeo cru com filtro CSS; o layout/câmera/legenda só aparecem numa miniatura. Novo palco com duas visões alternáveis:

- **Saída 9:16** (padrão): canvas desenhado com o mesmo pipeline da exportação, então o que se vê é exatamente o que sai.
- **Fonte**: vídeo original com a moldura de recorte por cima, para posicionar com precisão.

Sobreposições no palco: guias de terços, área segura das redes sociais, régua de zoom, e opção de comparar antes/depois segurando um botão.

## 3. Controles e interação

- Transporte completo: play/pause, frame a frame, ir ao início/fim, velocidade (0,25x–2x), loop no trecho selecionado, tempo editável.
- Atalhos de teclado: espaço, J/K/L, setas (frame), Shift+setas (1s), I/O (marcar entrada e saída), S (dividir), K (keyframe), Delete, Ctrl+Z / Ctrl+Shift+Z, 1–9 (ferramentas).
- **Undo/redo real** para toda a edição (histórico de estado), com indicação do que foi desfeito.
- Snap magnético já existente na timeline estendido para keyframes, cortes de segmento e início/fim de legenda.
- Botão Resetar passa a pedir confirmação com desfazer (padrão do projeto).

## 4. Timeline mais profissional

- Trilhas empilhadas e rotuladas: Vídeo (filmstrip), Áudio (onda), Câmera (blocos de segmento coloridos), Keyframes, Legenda.
- Zoom da timeline (roda do mouse com âncora no cursor) e rolagem horizontal; playhead sempre visível.
- Arrastar keyframes e limites de segmento com leitura de tempo ao lado do cursor.
- Ferramentas rápidas na régua: dividir no playhead, apagar trecho, marcar entrada/saída.

## 5. Acabamento visual

- Tema escuro consistente com os tokens do projeto, sem cores fixas.
- Estados vazios e dicas curtas na primeira vez em cada ferramenta.
- Feedback claro em ações longas (detecção de fala, tradução, detecção de pessoas) com progresso e cancelamento.
- Layout responsivo: em telas estreitas o inspetor vira uma gaveta inferior.

## Notas técnicas

- `src/components/VideoStudio.tsx` (1.163 linhas) é quebrado em: `editor/EditorShell.tsx` (layout + atalhos + histórico), `editor/StagePreview.tsx` (canvas de saída usando `drawFrame` e `resolveFraming`), `editor/ToolRail.tsx`, e um painel por ferramenta em `editor/panels/*` reaproveitando o código atual de cada aba sem mudar a lógica.
- Preview de saída: `requestAnimationFrame` desenhando `drawFrame` com o `PreEdit` atual — o mesmo caminho de `LayoutPreview.tsx` e da exportação, então preview e MP4 continuam idênticos.
- Histórico: hook `useEditorHistory` guardando snapshots de `{ pre, start, end, captions, texts }` com coalescência por tempo para arrastes.
- `EditorTimeline.tsx` ganha zoom/scroll e trilhas rotuladas; a matemática de wheel-zoom usa fator exponencial com âncora no cursor e listener não passivo.
- Sem mudanças em `draw.ts`, `encode.ts`, `render.ts` ou no backend: é trabalho de interface e organização.
