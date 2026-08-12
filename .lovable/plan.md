# Plano de Unificação de Edição Visual (Legendas, Anti-duplicidade e Cores)

Mover as funcionalidades de estilo de legenda, configuração de anti-duplicidade e filtros de cores da raiz do sistema para dentro do **VideoStudio**, unificando o editor de vídeo como a central de personalização visual.

## Mudanças de Interface (User-facing)
- **Aba de Legendas no Estúdio**: O painel de personalização de estilos de legenda agora será uma aba dentro do VideoStudio.
- **Aba de Anti-duplicidade**: Uma nova aba no VideoStudio permitirá configurar os parâmetros de variação por vídeo, com o toggle de preview em tempo real integrado.
- **Aba de Cores/Filtros**: Centralização dos presets de cores e ajustes de brilho/contraste/saturação em uma aba dedicada.
- **Aba de Textos**: Gestão de headline e textos dinâmicos do template também movida para o editor.

## Detalhes Técnicos

### 1. Reestruturação do VideoStudio (`src/components/VideoStudio.tsx`)
- Adicionar os estados de `CaptionStyle` e `AntiDupConfig` ao contexto do editor.
- Integrar o componente `CaptionStudio` como o conteúdo da aba "caps".
- Criar novos componentes internos ou abas para as configurações de anti-duplicidade e cores.
- Garantir que as alterações feitas no estúdio reflitam no `Template` ativo ou nos metadados do `Item` da fila.

### 2. Integração de Preview (`src/components/editor/StagePreview.tsx`)
- Atualizar o componente de preview do estúdio para aplicar os filtros de anti-duplicidade em tempo real quando o toggle estiver ativo.
- Passar os parâmetros de variação para o pipeline de desenho (`drawFrame`).

### 3. Ajustes na Home (`src/routes/index.tsx`)
- Remover os painéis flutuantes ou sidebars de legenda e anti-duplicidade que agora vivem no estúdio.
- O botão "Editar" ou a seleção de um vídeo da fila abrirá o estúdio completo com todas essas ferramentas.

### 4. Modelo de Dados
- Sincronizar os ajustes feitos no VideoStudio de volta para o `Item` da fila e, se necessário, atualizar o `activeTemplate`.
