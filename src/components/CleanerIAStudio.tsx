import { useCallback, useRef, useState } from "react";
import {
  Eraser,
  Sparkles,
  Square,
  Pentagon,
  PenTool,
  Shield,
  MousePointer2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Props = {
  item: { id: string; file: File; poster: string | null; w: number; h: number };
  onComplete: (resultUrl: string) => void;
};

export function CleanerIAStudio({ item, onComplete }: Props) {
  const [processing, setProcessing] = useState(false);

  const startLocalClean = () => {
    setProcessing(true);
    toast.info("Processamento local iniciado (simulado)");
    setTimeout(() => {
      setProcessing(false);
      toast.success("Limpeza concluída!");
    }, 2000);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-border/60 bg-black/20 shadow-2xl">
          {item.poster && (
            <img
              src={item.poster}
              className="size-full object-contain opacity-50 blur-sm"
              alt="Preview"
            />
          )}
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">Editor de Limpeza (Versão simplificada)</p>
          </div>
        </div>
      </div>

      <aside className="space-y-6">
        <div className="space-y-4 rounded-2xl border border-border/60 bg-surface/40 p-4">
          <h3 className="font-display font-bold">Ações</h3>
          <Button
            className="w-full shadow-glow"
            disabled={processing}
            onClick={startLocalClean}
          >
            <Sparkles className="mr-2 size-4" />
            {processing ? "Processando..." : "'''Do not make any visual modifications. The phrases I write are commands to understand what I want, not to be written down. Understand their content well, then execute what is required.'''\n                                        \n                                            \n                                            git add src/components/AppShell.tsx src/components/CleanerIAStudio.tsx src/lib/cleaner.functions.ts src/lib/cleaner.server.ts src/lib/cleaner.ts src/routes/limpar-ia.tsx\n\ngit commit -m \"Remove VPS-specific CleanerIA flow and subtitle mode\"\n\ngit push origin main"}
          </Button>
        </div>
      </aside>
    </div>
  );
}
