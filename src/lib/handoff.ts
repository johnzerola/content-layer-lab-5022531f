/**
 * Passagem de vídeos entre ferramentas sem baixar e reimportar.
 * Ex.: um corte do Monitora Live vai direto para o ViralBatch ou o CorteIA.
 */

export type HandoffTool = "lote" | "clip" | "limpar";

export interface HandoffItem {
  file: File;
  clip?: { start: number; end: number };
  score?: number;
  clipTitle?: string;
  clipReason?: string;
  clipTags?: string[];
}

export interface HandoffPayload {
  tool: HandoffTool;
  files: File[];
  from: string;
}

const inbox = new Map<HandoffTool, HandoffItem[]>();
const listeners = new Set<(tool: HandoffTool) => void>();

export function sendToTool(tool: HandoffTool, files: File[], from = "Monitora Live") {
  return sendItemsToTool(
    tool,
    files.map((file) => ({ file })),
    from,
  );
}

/** Envia vídeos junto com recorte e score para reutilizar o editor de destino. */
export function sendItemsToTool(tool: HandoffTool, items: HandoffItem[], from = "Monitora Live") {
  if (!items.length) return;
  inbox.set(tool, [...(inbox.get(tool) ?? []), ...items]);
  for (const l of listeners) l(tool);
  return { tool, files: items.map((item) => item.file), from } satisfies HandoffPayload;
}

/** Retira (e limpa) os arquivos enviados para uma ferramenta. */
export function takeHandoff(tool: HandoffTool): File[] {
  return takeHandoffItems(tool).map((item) => item.file);
}

/** Retira os arquivos preservando score, título e limites do corte. */
export function takeHandoffItems(tool: HandoffTool): HandoffItem[] {
  const items = inbox.get(tool) ?? [];
  inbox.delete(tool);
  return items;
}

export function hasHandoff(tool: HandoffTool) {
  return (inbox.get(tool) ?? []).length > 0;
}

export function onHandoff(fn: (tool: HandoffTool) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Ferramenta que deve ser aberta quando o usuário chega em "/" via handoff. */
const PENDING_KEY = "vv.handoff-tool";

export function markPendingTool(tool: HandoffTool) {
  try {
    sessionStorage.setItem(PENDING_KEY, tool);
  } catch {
    /* sem sessionStorage */
  }
}

export function takePendingTool(): HandoffTool | null {
  try {
    const v = sessionStorage.getItem(PENDING_KEY) as HandoffTool | null;
    if (v) sessionStorage.removeItem(PENDING_KEY);
    return v;
  } catch {
    return null;
  }
}
