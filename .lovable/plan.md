# SaaS Professionalization & Scalability Architecture

Este plano foca em transformar o MVP em um sistema SaaS robusto, seguro e escalável para múltiplos usuários, garantindo que o backend e o frontend sigam padrões profissionais de desenvolvimento.

## Core Goals
- **Multi-tenancy**: Garantir isolamento total de dados entre usuários via RLS.
- **Resiliência**: Implementar tratamento de erros unificado e logs de depuração.
- **Desempenho**: Otimizar renderização e exportação de vídeos longos.
- **Documentação**: Centralizar o conhecimento técnico para futuros desenvolvedores.

## Proposed Changes

### 1. Robust Type Safety & Error Reporting
- Implementar um sistema de log centralizado no servidor para erros capturados no cliente.
- Validar rigorosamente todas as entradas de `createServerFn` usando Zod.
- Adicionar middleware de autenticação em todas as funções que acessam dados sensíveis.

### 2. Multi-tenant Protection (RLS)
- Auditar e reforçar políticas de Row Level Security (RLS) em todas as tabelas:
  - `cleaner_jobs`: Acesso apenas ao proprietário.
  - `scheduled_posts`: Acesso apenas ao proprietário.
  - `templates` e `projects`: Acesso apenas ao proprietário.
- Garantir que `GRANT` statements estejam presentes em todas as migrações futuras.

### 3. Asset & State Management
- Implementar fallback automático para armazenamento em nuvem quando o `localStorage` atingir o limite (já iniciado, expandir para projetos e rascunhos).
- Otimizar o gerenciamento de blobs de vídeo no IndexedDB para evitar vazamentos de memória.

### 4. Technical Documentation
- Criar `api-reference.md` documentando todos os endpoints de servidor.
- Documentar o fluxo de handoff entre ferramentas (`ViralBatch` -> `CleanerIA`).
- Documentar a integração com o worker GPU ProPainter.

## Technical Details
- **Middleware**: Uso sistemático de `attachSupabaseAuth` e `requireSupabaseAuth`.
- **Validation**: Zod para tipagem estática e validação em runtime.
- **RLS**: Uso de `auth.uid()` em todas as políticas `USING`.
- **Storage**: Limpeza automática de arquivos temporários na VPS após o processamento.
