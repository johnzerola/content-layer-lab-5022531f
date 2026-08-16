# VaiViral - Documentação do Desenvolvedor

Este documento serve como guia central para desenvolvedores que trabalham no ecossistema VaiViral.

## Visão Geral do Sistema
O VaiViral é uma plataforma SaaS para criação e automação de conteúdo viral (Reels, TikTok, Shorts).

### Core Stack
- **Framework:** TanStack Start v1 (React 19 + Vite)
- **Backend:** TanStack Server Functions + Supabase (PostgreSQL + RLS)
- **Estilização:** Tailwind CSS v4
- **Processamento de Vídeo:**
  - Frontend: WebCodecs / Canvas (Fast Visual Edit)
  - Backend (GPU): ProPainter / PaddleOCR (Limpeza Profissional via VPS dedicada)

## Arquitetura de Pastas
- `src/routes/`: Definições de rotas e páginas.
- `src/components/`: Componentes React reutilizáveis.
- `src/lib/`: Lógica de negócio, funções de servidor (*.functions.ts) e helpers.
- `src/integrations/`: Conectores com serviços externos (Supabase, etc).

## Fluxos Principais

### 1. Monitora Live (`src/routes/live.tsx`)
Monitoramento em tempo real de streams (X, Kick, TikTok) usando HLS e captura de trechos baseada em análise de áudio/movimento.

### 2. ViralBatch (`src/routes/index.tsx`)
Processamento em lote onde um template JSON é aplicado a múltiplos vídeos de entrada.

### 3. Publicação Automática (`src/lib/publish.server.ts`)
Integração com a API Graph da Meta para publicação direta em contas conectadas.

## Prevenção de Bugs e Manutenção
- **Segurança:** Sempre use `requireSupabaseAuth` em funções de servidor que acessam dados sensíveis.
- **RLS:** Toda nova tabela deve ter políticas de Row Level Security e `GRANT` explícito para `authenticated`.
- **Handoff:** O sistema utiliza um padrão de "handoff" (`src/lib/handoff.ts`) para passar estados entre ferramentas sem persistência global desnecessária.

## Documentação Técnica Detalhada
- [Arquitetura de Banco de Dados](architecture/database.md)
- [Integração Meta API](architecture/meta-integration.md)
- [Sistema de Cleaner IA](architecture/cleaner-ia.md)
