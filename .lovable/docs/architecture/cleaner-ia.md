# Sistema de Cleaner IA (VPS Worker)

A ferramenta CleanerIA utiliza um motor externo para garantir alta qualidade na remoção de elementos indesejados.

## Motor ProPainter
- **URL:** `https://cleaner-104-234-186-50.nip.io`
- **Funcionalidade:** Reconstrução temporal profunda para remoção de legendas e marcas d'água sem deixar rastros visuais (borrões).

## Fluxo de Comunicação
1. **Upload:** O frontend envia o vídeo diretamente para a VPS ou via proxy (`src/lib/cleaner.functions.ts`).
2. **Processamento:** A VPS executa o modelo ProPainter.
3. **Resultados:** O frontend monitora o status do job e baixa o vídeo processado assim que finalizado.

## Manutenção do Worker
O worker é uma API FastAPI rodando em ambiente Linux com suporte a GPU (CUDA). Se o worker estiver offline, a interface exibirá um aviso de "Motor Offline".
