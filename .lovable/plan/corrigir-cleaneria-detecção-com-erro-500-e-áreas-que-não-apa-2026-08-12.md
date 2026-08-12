# Corrigir CleanerIA: detecção com erro 500 e áreas que não aparecem

## O que os prints mostram

- "Erro na detecção: Internal Server Error" ao clicar em **Detectar**.
- "Marque ao menos uma área ou use Detectar" ao clicar em **Processar**, com **Áreas (0)**.

## O que foi verificado

- O motor GPU está online: responde `/v1/health` com `{"online":true, "cuda":false, "gpu":"cpu"}` — ou seja, está rodando **sem GPU (CPU)**, o que funciona mas é lento.
- No motor, `detect` chama `probe(storage/<job>/input.mp4)`. Se o vídeo daquele job **não chegou no motor** (upload falhou ou nunca aconteceu), essa chamada estoura uma exceção não tratada e o FastAPI devolve um 500 genérico — exatamente o "Internal Server Error" do print.
- No app, o botão **Detectar** fica habilitado mesmo quando o upload não foi concluído, e o erro do motor chega como texto cru, sem dizer o motivo.

Diagnóstico: o job existe no banco, mas o arquivo não está no motor. A causa raiz do 500 é o vídeo ausente; falta tratamento de erro nas duas pontas.

## O que será feito

1. **Motor (backend)**
   - Em `detect` e `process`: verificar se `input.mp4` existe antes de processar e responder `409` com mensagem clara ("vídeo não recebido — refaça o envio") em vez de 500.
   - Envolver a detecção em try/except, devolvendo mensagem legível (`{"error": ...}`) em vez de stack trace.
   - Novo endpoint leve `GET /v1/jobs/{id}/input` informando se o arquivo existe, tamanho e duração.

2. **App (CleanerIA)**
   - Após o upload, confirmar no motor que o arquivo chegou (usando o novo endpoint) antes de marcar o job como "pronto". Se não chegou, o upload é tratado como falho e o usuário é avisado.
   - **Detectar** e **Processar** ficam desabilitados enquanto o vídeo não estiver confirmado no motor, com aviso "envie o vídeo primeiro".
   - Mensagens de erro traduzidas: 409 vira "o vídeo não está no motor — reenvie", 401/403 vira "sessão expirada", falha de rede vira "motor inacessível".
   - Botão **Reenviar vídeo** quando a confirmação falhar, sem precisar recriar o job.

3. **Marcação de áreas**
   - O palco de desenho só habilita quando há vídeo carregado no preview; enquanto isso mostra uma instrução clara em vez de uma área morta.

4. **Aviso de modo CPU**
   - O painel de status passa a mostrar "modo CPU — processamento lento" quando o motor reporta `cuda:false`, para não parecer travamento.

## Detalhes técnicos

- Arquivos: `backend/app/main.py` (checagem de arquivo + tratamento de erro + endpoint de input), `src/lib/cleaner.server.ts` e `src/lib/cleaner.functions.ts` (repasse do status/erro do motor), `src/components/CleanerIAStudio.tsx` (confirmação pós-upload, estados dos botões, mensagens, reenvio, aviso CPU).
- O backend em `backend/` precisa ser reimplantado no servidor para as mudanças de motor valerem; isso será feito no mesmo passo.
