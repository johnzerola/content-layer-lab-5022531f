# LimpaVídeo: remoção automática de legenda e marca d'água (estilo Vmake)

## O que testei agora

Gerei um vídeo de teste 540x960 com legenda queimada no rodapé e marca d'água `@vmakelabs` no canto superior direito, e rodei o detector real do app dentro do navegador.

Resultado (1,4s de análise, 5 áreas):

- Legenda do rodapé: **acertou** (y 0.78, largura 0.73 — cobre o texto).
- Marca d'água do topo: **errou a posição** — marcou y 0.13 enquanto o logo está em y 0.04–0.07, ou seja, a área gerada não cobre a marca.
- 3 falsos positivos em áreas sem overlay.

Ou seja: o fluxo ponta a ponta já existe (detecta ao importar → aplica por vídeo → processa → exporta MP4 H.264 com áudio), mas a **precisão** ainda não entrega o resultado "manda o vídeo e recebe limpo" da Vmake.

## O que construir

### 1. Detector mais preciso
- Amostragem em duas resoluções: mapa global (rápido) + varredura fina nas faixas de topo/rodapé/cantos, onde ficam legendas e logos pequenos. Hoje tudo é analisado a 192px de largura, o que apaga texto fino no topo.
- Mediana temporal por pixel: marca d'água semi-transparente fica idêntica em todos os quadros; comparar cada quadro com a mediana revela o overlay com muito mais nitidez que a variância atual.
- Filtro anti-falso-positivo: exigir persistência do sinal em pelo menos ~60% dos quadros amostrados e forma compatível com texto/logo (densidade de bordas + proporção), descartando o resto.
- Ajuste da caixa: expandir a região até o contorno real do overlay em vez de arredondar por célula, evitando cortar metade da marca.

### 2. Remoção com qualidade (sem borrão)
- Para overlay estático: reconstruir o fundo pela **mediana temporal** dos quadros em que a área está limpa — recupera pixels reais, não inventados. É o que dá o resultado limpo dos sites de referência.
- Quando não há quadro limpo, cai para o inpaint atual (Telea + detalhe por exemplar), já implementado.
- Legenda intermitente: guardar em quais intervalos de tempo a área tem texto e só tratar nesses trechos, deixando o resto do vídeo intocado.

### 3. Fluxo de 1 clique
- Importar (arquivos ou pasta) → análise automática já roda → botão **"Limpar tudo e baixar"**: processa a fila inteira e entrega os MP4 limpos (ou ZIP), mantendo resolução, proporção e áudio originais.
- Antes/depois com slider por vídeo para conferência, sem obrigar ajuste manual.
- Ajuste manual continua disponível para quem quiser corrigir uma área.

### 4. Validação
- Suíte de fixtures sintéticas (legenda de rodapé, logo de canto, marca d'água central transparente, texto no topo) com verificação automática de que a área detectada cobre o overlay e de que nada relevante fora dele é marcado.

## Detalhes técnicos

- `src/lib/detect.ts`: reescrita do núcleo para mediana temporal + varredura em faixas + filtro de persistência; retorno passa a incluir `timeRanges` opcional por região.
- `src/lib/template.ts`: campo `timeRanges?: {start:number;end:number}[]` em `CleanupRegion`.
- `src/lib/inpaint.ts` / `src/lib/draw.ts`: novo caminho `background-median` (placa de fundo pré-calculada por vídeo, passada via opções de render) com fallback para o inpaint atual; respeitar `timeRanges` na hora de desenhar.
- `src/routes/index.tsx`: pré-cálculo da placa de fundo por item antes do render, botão "Limpar tudo e baixar" no modo LimpaVídeo.
- `src/lib/__tests__`: testes das funções puras de agrupamento/filtro; fixtures de vídeo geradas em runtime por canvas.

## Fora do escopo

Remoção de objetos em movimento e rastreamento de texto que se desloca pela tela (isso exigiria modelo de visão rodando no servidor).
