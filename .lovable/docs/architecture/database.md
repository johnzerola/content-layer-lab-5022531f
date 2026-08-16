# Arquitetura de Banco de Dados

O sistema utiliza Supabase (PostgreSQL) com segurança baseada em RLS.

## Tabelas Principais

### `user_roles`
Gere as permissões de acesso (admin, user).
- **Importante:** Nunca armazene roles diretamente na tabela de profiles.

### `scheduled_posts`
Fila de processamento para redes sociais.
- `status`: 'agendado', 'processando', 'publicado', 'falhou'.
- `meta_data`: Armazena o ID do container da Meta e erros de resposta.

### `global_meta_accounts`
Armazena os tokens de acesso validados para a API da Meta.

## Boas Práticas
1. **Migrations:** Todas as alterações de schema devem ser documentadas na pasta `supabase/migrations/`.
2. **RPCs:** Utilize funções `SECURITY DEFINER` para operações que exigem bypass controlado de RLS, como o processamento da fila de publicação.
