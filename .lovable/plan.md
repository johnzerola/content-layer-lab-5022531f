# Plano de Implementação: Motor de Clipagem Estilo OpusClip

Este plano visa elevar a inteligência do sistema de cortes automáticos, focando em narrativa, ganchos (hooks) e retenção, aproximando a experiência da VaiViral à do OpusClip.

## O que será implementado

### 1. Inteligência Narrativa no `src/lib/clips.ts`
- **Detecção de Ganchos (Hook Detection):** Refinamento do algoritmo para identificar picos de energia e início de frases de impacto nos primeiros 3 segundos.
- **Storytelling Scoring:** Nova métrica que avalia se o trecho possui uma conclusão narrativa baseada em pausas e cadência de voz.
- **Filtro de Retenção:** Penalização de silêncios longos e trechos com baixa densidade de fala.

### 2. Refinamento de Interface no `src/components/ClipStudio.tsx`
- **Visual OpusClip Style:** Ajuste no `ClipCard` para destacar o "Viral Score" de forma mais proeminente.
- **Explicação da IA:** Exibição clara do motivo pelo qual a IA escolheu aquele corte (ex: "Gancho inicial forte", "História completa").
- **Tags de Momento:** Exibição de etiquetas como "Highlight", "Curiosidade" ou "CTA".

### 3. Melhorias no Monitoramento de Live (`src/lib/live.ts`)
- **Sincronização de Algoritmos:** Portar as melhorias de detecção de ganchos do processamento em lote para a análise em tempo real de lives.
- **Auto-Framing Dinâmico:** Integração do `FaceDetector` no preview de cortes da live para garantir enquadramento 9:16 focado no orador.

### 4. Handoff de Storytelling
- Garantir que as informações de título, descrição e tags geradas pela IA sejam mantidas quando um corte for enviado do Monitora Live para o CorteIA ou ViralBatch.

## Detalhes Técnicos
- Atualização da função `scoreClipSignals` para novos pesos de retenção.
- Implementação de `describeCandidate` com mapeamento para rótulos de marketing viral.
- Refinamento do `speechSegments` com bridge adaptativo para evitar cortes no meio de palavras.

---
*Nota: Não serão feitas modificações visuais drásticas, apenas refinamentos de layout para exibir os novos dados de inteligência.*
