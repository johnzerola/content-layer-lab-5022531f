# Publicação social

## Arquitetura

```text
vídeo -> scheduled_posts -> scheduler -> claim RPC -> social_account
      -> social_connection -> publish() -> provider adapter -> API externa
```

`video_path` é a referência permanente. Cada tentativa cria uma nova URL
assinada no servidor; `video_url` existe apenas para compatibilidade com
registros antigos.

`claim_due_scheduled_posts` reivindica trabalhos com `FOR UPDATE SKIP LOCKED`,
incrementa `attempts` e também recupera locks vencidos. Falhas temporárias
retornam a `agendado` com `next_attempt_at`; falhas permanentes ou tentativas
esgotadas passam para `falhou`.

## Configuração

Use os nomes documentados em `.env.example`. Segredos nunca usam prefixo
`VITE_`. O endpoint aceita somente:

```text
POST /api/public/hooks/publish-due
Authorization: Bearer <PUBLISH_CRON_SECRET>
```

O segredo deve ter pelo menos 32 caracteres. Em desenvolvimento, faça uma
chamada manual com esse header. A resposta contém apenas contadores.

## Scheduler

O Supabase hospedado suporta Cron (`pg_cron`), chamadas HTTP por `pg_net` e
segredos criptografados no Vault. A ativação não está em migration porque URL e
segredo variam por ambiente e nunca devem entrar no Git.

### Ativação recomendada no Supabase

1. Publique a aplicação e configure nela `PUBLISH_CRON_SECRET` com um valor
   aleatório de pelo menos 32 caracteres.
2. No Dashboard do Supabase, abra **Integrations → Vault** e crie:
   - `publish_dispatch_url`: URL completa HTTPS terminando em
     `/api/public/hooks/publish-due`;
   - `publish_cron_secret`: exatamente o mesmo valor configurado na aplicação.
3. Abra **Integrations → Cron → Create job**.
4. Use o nome `publish-due-every-minute` e a expressão `* * * * *`.
5. Escolha SQL snippet e salve exatamente:

```sql
select net.http_post(
  url := (
    select decrypted_secret
    from vault.decrypted_secrets
    where name = 'publish_dispatch_url'
  ),
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'publish_cron_secret'
    )
  ),
  body := jsonb_build_object('triggered_at', now()),
  timeout_milliseconds := 55000
) as request_id;
```

O intervalo recomendado é um minuto: mantém precisão suficiente para posts e
permite que `next_attempt_at` seja reavaliado automaticamente sem chamadas
excessivas.

### Validação

Teste primeiro o endpoint fora do Cron:

```bash
curl --request POST \
  --header "Authorization: Bearer $PUBLISH_CRON_SECRET" \
  --header "Content-Type: application/json" \
  "https://SEU_DOMINIO/api/public/hooks/publish-due"
```

Resposta saudável, mesmo sem posts:

```json
{"ok":true,"processed":0,"published":0,"retrying":0,"failed":0}
```

Depois confira o job e as últimas execuções no SQL Editor:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'publish-due-every-minute';

select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (
  select jobid from cron.job where jobname = 'publish-due-every-minute'
)
order by start_time desc
limit 20;
```

No aplicativo, valide que `last_attempt_at` avança e que posts vencidos deixam
`agendado`. Para falhas temporárias, confirme `next_attempt_at` no futuro.

Para desativar com segurança:

```sql
select cron.unschedule('publish-due-every-minute');
```

## Contas e credenciais

`social_connections` é server-only: `anon` e `authenticated` não têm grants e
não há policy de leitura. Ela guarda somente referências opacas para um secret
store externo, nunca tokens em texto puro. Antes de habilitar OAuth real, é
necessário escolher e configurar esse secret store. `social_oauth_states`
reserva estados OAuth com digest e expiração, também server-only.

O fallback global existente continua disponível para Instagram:

- Ayrshare: `AYRSHARE_API_KEY`;
- Meta: `META_ACCESS_TOKEN` + `META_IG_USER_ID`.

Durante o estágio atual de teste/administração, a vinculação Meta valida no
servidor o `id` e o `username` retornados por `graph.instagram.com` e persiste
somente `provider = meta`, `provider_account_id` e o estado `conectado`. O token
global permanece exclusivamente no ambiente do servidor; nenhum `secret_ref`
falso é criado. Uma `social_connection` explícita sempre tem prioridade sobre
o fallback global, que existe apenas para registros legados `pending`.

Uma conexão por conta pode selecionar `meta` ou `ayrshare`, mas credenciais por
usuário só devem ser ativadas depois que o secret store estiver disponível.

Facebook, TikTok e YouTube aparecem como “Em preparação”; não existem adapters
de publicação para essas plataformas.

## Diagnóstico

Consulte `scheduled_posts.status`, `attempts`, `error_code`, `error` e
`next_attempt_at`. Logs estruturados incluem IDs, plataforma, provider,
tentativa, duração e código normalizado. Eles não incluem tokens, API keys,
authorization codes nem URLs assinadas.
