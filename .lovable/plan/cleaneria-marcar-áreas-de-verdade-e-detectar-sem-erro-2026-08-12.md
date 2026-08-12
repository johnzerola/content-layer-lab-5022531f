# CleanerIA: marcar áreas de verdade e detectar sem erro

## O que os prints mostram

- Painel lateral com "Áreas (0)" e o aviso "Marque ao menos uma área ou use Detectar".
- O palco do vídeo aparece cortado na tela: os controles de máscara ficam fora da área visível e sobra pouco espaço para desenhar.

## O que foi verificado agora

- O motor está online e respondendo (`/v1/health` → `online: true`), rodando em **modo CPU** (sem GPU), portanto lento.
- O motor já tem o endpoint de conferência do arquivo (`/v1/jobs/{id}/input` responde 401 sem token, ou seja, existe e valida token) — a versão nova está implantada.
- Na tela, o palco só aceita desenho quando `videoReady` fica verdadeiro; enquanto isso mostra "carregando vídeo…". Nenhum feedback aparece se o vídeo local não carregar (codec/preview), o que deixa o palco permanentemente inativo e as áreas em 0.

## O que será feito

1. **Palco de marcação sempre utilizável**
   - Layout do estúdio reorganizado: vídeo e ferramentas de máscara em coluna principal com altura garantida, painel de precisão/áreas ao lado com rolagem própria, sem cortar botões.
   - Barra de ferramentas (retângulo, polígono, pincel, proteger, apagar) visível acima do vídeo, com a ferramenta ativa destacada.
   - Se o vídeo local não gerar metadados em poucos segundos, liberar a marcação assim que o primeiro quadro/poster estiver disponível e avisar em vez de travar em "carregando".

2. **Feedback de marcação**
   - Ao soltar o mouse criando uma área muito pequena, mostrar dica ("arraste para criar uma área maior") em vez de descartar em silêncio.
   - Contador "Áreas (n)" com lista clicável, seleção, renomear intervalo de tempo e excluir.
   - Atalho "Cobrir rodapé" e "Cobrir topo" que criam a máscara típica de legenda/marca d'água em um clique.

3. **Detectar mais confiável**
   - Antes de chamar detectar, revalidar a presença do vídeo no motor; se faltar, oferecer "Reenviar vídeo" direto no aviso.
   - Erros do motor traduzidos e exibidos com a causa (arquivo ausente, token expirado, motor inacessível) em vez de "Internal Server Error".
   - Quando nada for detectado, sugerir automaticamente a máscara de rodapé para o usuário só confirmar.

4. **Aviso de CPU**
   - Faixa fixa no topo do estúdio: "modo CPU — processamento lento", enquanto o motor reportar `cuda:false`.

## Detalhes técnicos

- Arquivo principal: `src/components/CleanerIAStudio.tsx` (layout em grid, gating de `videoReady`, toolbar, lista de áreas, atalhos de máscara, mensagens de erro).
- `src/lib/cleaner.server.ts`: manter a tradução de status (409/401/404) e acrescentar mensagem para 422/500 do motor.
- Sem mudanças de banco. Sem redeploy do motor necessário nesta etapa.
