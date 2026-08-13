# Plano de Restauração de Layout - VaiViral

Restaurar a interface para o layout de "Herói de Ferramenta Independente" conforme as capturas de tela (file-10 a file-13), removendo a grade de duas colunas introduzida recentemente e centralizando o fluxo de upload/importação.

## Alterações Visuais

- **Layout de Herói**: Cada ferramenta (ViralBatch, CorteIA, LimpaVideo, CleanerIA) terá uma seção de cabeçalho proeminente com título, descrição e tags.
- **Workflow Centralizado**: O seletor de arquivos e entrada de link ficarão centralizados na página em vez de estarem em uma barra lateral.
- **AppShell**: Ajustar a barra lateral para ser mais compacta e condizer com o tema neon escuro das referências.
- **Rodapé de Status**: Manter o indicador de saúde do CleanerIA mas integrá-lo de forma discreta ao novo layout.

## Detalhes Técnicos

- **src/routes/index.tsx**:
    - Reverter a estrutura `lg:grid-cols-[1fr_420px]` para um layout de coluna única com largura máxima controlada.
    - Implementar componentes de "Hero" específicos para cada `mode`.
    - Mover a lógica de importação (dropzone/URL) para o centro da visualização inicial de cada modo.
- **src/components/AppShell.tsx**:
    - Refinar estilos de navegação para corresponder à estética das imagens (bordas sutis, estados ativos neon).
- **CleanerIAStudio.tsx**:
    - Garantir que o painel de depuração e status não quebre o novo fluxo visual.

## Checklist de Verificação

- [ ] Layout responsivo em mobile/desktop.
- [ ] Transição suave entre ferramentas.
- [ ] Feedback visual claro de "Motor Online/Offline".
- [ ] Fluxo de upload visível imediatamente ao entrar em qualquer ferramenta.
