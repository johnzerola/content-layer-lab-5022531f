# API Reference: VaiViral SaaS

Este documento mapeia todos os endpoints de servidor (`createServerFn`) disponíveis no sistema para facilitar futuras implementações e integrações.

## Autenticação
Todos os endpoints marcados com `[Auth]` exigem o middleware `requireSupabaseAuth` e enviam o cabeçalho `Authorization: Bearer <token>`.

## 1. Importação & Mídia (`src/lib/import.functions.ts`)
- `resolveVideoLink(url: string)`: Resolve links de plataformas sociais (YT, IG, TikTok) para URLs diretas de MP4/WebM.
- `media-proxy`: Servidor de proxy para download de arquivos de vídeo remotos evitando bloqueio de CORS.

## 2. CleanerIA (GPU Workerd) (`src/lib/cleaner.functions.ts`)
- `cleanerHealth()`: Verifica se o worker GPU ProPainter está online.
- `createCleanerJob(filename, size, mode, preset)`: [Auth] Inicia um novo processo de limpeza.
- `confirmCleanerUpload(id)`: [Auth] Notifica que o arquivo foi enviado à VPS.
- `processCleanerJob(id, masks, options)`: [Auth] Dispara o motor ProPainter na VPS.
- `refreshCleanerJob(id)`: [Auth] Sincroniza o estado do job com a VPS.

## 3. Legendas & IA (`src/lib/transcribe.functions.ts`, `src/lib/translate.functions.ts`)
- `transcribeChunk(audio, language)`: [Auth] Transcreve áudio (base64) usando Lovable AI Gateway.
- `translateWords(words, language)`: [Auth] Traduz ganchos e palavras mantendo sincronismo temporal.

## 4. Redes Sociais & Agendamento (`src/lib/social.functions.ts`)
- `addAccount(username)`: [Auth] Vincula uma conta Instagram confirmando a identidade via Meta API.
- `publish-due`: [Cron] Endpoint chamado periodicamente para publicar posts agendados na fila.

## 5. Métricas & Performance (`src/lib/metrics.functions.ts`)
- `getMetrics()`: [Auth] Retorna dados de alcance, visualizações e curtidas dos posts publicados.
- `refreshPostMetrics(postId)`: [Auth] Atualiza os números de uma publicação específica.

## 6. Monitoramento de Live (`src/lib/live.functions.ts`)
- `checkXLive(target)`: [Auth] Verifica se um perfil está ao vivo e descobre a playlist HLS pública.
- `signedHlsProxyUrl(url)`: [Auth] Gera um ticket assinado para o proxy de transmissão HLS.
