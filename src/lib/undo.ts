import { toast } from "sonner";

/**
 * Ação destrutiva com desfazer: mostra um toast com botão "desfazer"
 * durante alguns segundos e só confirma a remoção quando o prazo passa.
 */
export function undoable(
  message: string,
  undo: () => void,
  opts?: { commit?: () => void; seconds?: number; description?: string },
) {
  const ms = (opts?.seconds ?? 7) * 1000;
  let undone = false;
  const timer = window.setTimeout(() => {
    if (!undone) opts?.commit?.();
  }, ms);

  toast(message, {
    duration: ms,
    ...(opts?.description ? { description: opts.description } : {}),
    action: {
      label: "desfazer",
      onClick: () => {
        undone = true;
        window.clearTimeout(timer);
        undo();
        toast.success("Desfeito.");
      },
    },
  });
}
