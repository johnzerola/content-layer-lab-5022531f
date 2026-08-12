import { History, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

function ago(ts: number) {
  const d = new Date(ts);
  const diff = Date.now() - ts;
  if (diff < 60_000) return "agora há pouco";
  if (diff < 3_600_000) return `há ${Math.round(diff / 60_000)} min`;
  const hoje = new Date().toDateString() === d.toDateString();
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (hoje) return `hoje às ${hora}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${hora}`;
}

export function RestoreBanner({
  count,
  updatedAt,
  busy,
  onRestore,
  onDiscard,
}: {
  count: number;
  updatedAt: number;
  busy?: boolean;
  onRestore: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3">
      <History className="size-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-sm">
        Você tem um lote de <strong>{count}</strong> vídeo{count === 1 ? "" : "s"} salvo {ago(updatedAt)}.
        <span className="ml-1 text-muted-foreground">Retome de onde parou ou comece um novo.</span>
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onRestore} disabled={busy}>
          <RotateCcw className="mr-1 size-3.5" />
          {busy ? "Retomando…" : "Retomar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard} disabled={busy}>
          <X className="mr-1 size-3.5" /> Começar novo
        </Button>
      </div>
    </div>
  );
}
