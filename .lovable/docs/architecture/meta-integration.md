# Integração Meta API

O motor de publicação (`src/lib/publish.server.ts`) gerencia o fluxo de envio de vídeos para o Instagram Reels e Feed.

## Fluxo de Publicação
1. **Criação de Container:** O vídeo (URL pública) é enviado para a Meta para criação de um container de mídia.
2. **Polling de Status:** O sistema aguarda (`check_status`) até que a Meta processe o vídeo (status 'FINISHED').
3. **Publicação Final:** O container processado é publicado no perfil do usuário.

## Configurações Necessárias
- `META_ACCESS_TOKEN`: Token de longa duração da aplicação.
- `META_IG_USER_ID`: ID da conta comercial do Instagram.
- `PUBLISH_CRON_SECRET`: Chave de segurança para disparar o worker de publicação.

## Tratamento de Erros
Erros da API da Meta são capturados e salvos na coluna `error_log` da tabela `scheduled_posts` para facilitar a depuração pelo usuário na interface de Agenda.
