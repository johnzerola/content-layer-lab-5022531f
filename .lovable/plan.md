# LimpaVídeo / CleanerIA v2 — remoção sem borrão, com legenda dinâmica

## Resposta curta à sua pergunta

Hoje o sistema remove legenda queimada, texto e marca d'água, mas **não está preparado para legenda automática que muda a cada palavra/frase durante o vídeo**. Isso foi confirmado lendo o pipeline atual:

- A detecção automática olha só **12 frames amostrados** do vídeo inteiro e transforma tudo em retângulos fixos válidos para o vídeo todo.
- O refino em nível de pixel (letra + contorno + sombra) roda a cada `frames/40` frames e **repete a mesma máscara** para o intervalo inteiro.
- Não existe verificação final: nada confere se sobrou texto depois de limpar.
- Quando não há referência temporal, o último recurso é `cv2.inpaint` (Navier-Stokes), que é exatamente o que gera aquele aspecto de mancha/borrão.
- Todos os frames são carregados na memória de uma vez, o que limita a duração do vídeo.

Ou seja: em vídeo com legenda estática funciona bem; em legenda karaokê/dinâmica sobra texto em alguns trechos e pode aparecer borrão nas bordas.

## Comparação com o mercado

Ferramentas do tipo (removedores de marca d'água e legenda comerciais) em geral trabalham com retângulo fixo desenhado pelo usuário e preenchimento espacial — por isso deixam mancha. Os melhores resultados públicos vêm de inpainting de vídeo com contexto temporal (ProPainter, E2FGVI, STTN, DiffuEraser), que é a linha que já adotamos. A vantagem competitiva real está em três pontos que ninguém entrega bem junto: **máscara por frame** (não retângulo fixo), **verificação automática do resultado** e **garantia de não-borrão**.

## O que vamos construir

### 1. Máscara por frame (resolve a legenda que muda)
Detecção de texto rodando ao longo de todo o vídeo em passo curto (com interpolação entre passos por optical flow), gerando uma máscara diferente para cada frame. Cada trecho de legenda vira um evento com início e fim próprios, então quando a palavra muda a máscara muda junto.

### 2. Máscara colada na letra, não na caixa
Segmentação de letra + contorno + sombra + glow com margem adaptativa ao tamanho da fonte, e feather nas bordas na hora de compor. Área reconstruída fica mínima — quanto menor o buraco, mais fiel a reconstrução.

### 3. Proteção do que não pode ser tocado
Máscara de proteção automática de rosto/pessoa: se a legenda encosta no sujeito, o motor não reconstrói por cima dele.

### 4. Política anti-borrão explícita
`cv2.inpaint` deixa de ser saída final. A ordem passa a ser: reconstrução temporal real → motor neural → e, se ainda sobrar buraco sem referência, síntese por casamento de trechos (patch match) em vez de difusão. Um teste de nitidez compara a área reconstruída com a vizinhança; se ficar mais lisa que o entorno, o trecho é reprocessado.

### 5. Verificação automática do resultado
Depois de limpar, o sistema roda OCR nas mesmas regiões: se ainda houver texto legível, ele engrossa a máscara e reprocessa só aqueles trechos. O relatório final mostra "texto residual: 0" e a nota de consistência temporal.

### 6. Vídeos longos
Processamento em streaming por janelas com sobreposição, sem carregar o vídeo inteiro na memória; costura das janelas com mistura para não piscar entre elas.

### 7. Interface
- Timeline mostrando onde cada legenda/logo foi detectado, com blocos por trecho.
- Botão "Detectar legenda dinâmica" (varredura completa) além do modo rápido.
- Comparação antes/depois com lupa e salto direto para os trechos de menor nota.
- Aviso claro quando um trecho não pôde ser reconstruído com qualidade, com opção de reprocessar só ele em preset máximo.

## Detalhes técnicos

- `backend/app/services/text_detect.py`: nova função de varredura temporal produzindo eventos `{frame_ini, frame_fim, polígono}`; máscara em polígono, não bounding box.
- `backend/app/services/tracking.py`: propagação da máscara entre frames-chave por optical flow denso, respeitando cortes de cena.
- Novo `backend/app/services/protect.py`: segmentação de pessoa/rosto para a máscara de proteção.
- Novo `backend/app/services/verify.py`: OCR pós-processo + métrica de nitidez local (variância do laplaciano dentro versus fora da máscara) e decisão de reprocesso.
- `backend/app/engines/inpainting.py`: `TemporalFillEngine` com busca bidirecional e validação de coerência; substituição do fallback difusivo por síntese baseada em patches; remoção do NS como saída final.
- `backend/app/workers/tasks.py`: pipeline em streaming por janelas, máscara por frame, passe de verificação e reprocesso seletivo, métricas novas no payload.
- `src/components/CleanerIAStudio.tsx`: faixa de detecções na timeline, modo varredura completa, relatório de qualidade por trecho e reprocesso pontual.

O processamento pesado continua no worker Python com GPU; o front só orquestra e mostra progresso.
