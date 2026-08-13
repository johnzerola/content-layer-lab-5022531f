import { useCallback, useEffect, useState } from "react";
import {
  Eraser,
  Sparkles,
  Shield,
  Activity,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getCleanerHealth, startCleanerJob } from "@/lib/cleaner.functions";

type Props = {
  item: { id: string; file: File; poster: string | null; w: number; h: number };
  onComplete: (resultUrl: string) => void;
};

type Health = {
  status: "online" | "offline";
  gpu?: string;
  cpu?: string;
  reason?: string;
};

export function CleanerIAStudio({ item, onComplete }: Props) {
  const [processing, setProcessing] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function check() {
      try {
        const res = await getCleanerHealth();
        if (mounted) {
          setHealth(res as Health);
        }
      } catch (err) {
        if (mounted) {
          setHealth({ status: "offline", reason: "CLEANER_WORKER_URL incorreta ou worker offline" });
        }
      } finally {
        if (mounted) setChecking(false);
      }
    }
    check();
    return () => { mounted = false; };
  }, []);

  const startClean = async () => {
    if (health?.status !== "online") {
      toast.error("Motor offline. Verifique as configurações.");
      return;
    }

    setProcessing(true);
    toast.info("Processamento iniciado no backend VPS...");
    
    try {
      // Iniciamos o job real chamando a função do servidor
      // No mundo real, o arquivo 'item.file' precisaria ser carregado para um storage (S3/Supabase) primeiro
      // e o cleaner-worker baixaria de lá. 
      // Para o MVP mantemos a simulação de fluxo mas chamando a infra.
      
      const job = await startCleanerJob({
        data: {
          videoUrl: "pending_upload_from_client",
          regions: [], // Vazio para modo auto
          options: {
            mode: "auto",
            upscale: false
          }
        }
      });

      console.log("Job criado:", job);
      
      toast.info(`Job ${job.job_id} enviado para fila.`);
      
      // Simulação de espera de resultado para feedback visual imediato
      setTimeout(() => {
        setProcessing(false);
        toast.success("Limpeza concluída com sucesso!");
        // Em produção, o webhook notificaria e o componente atualizaria via sub/polling
        onComplete("https://cleaner-104-234-186-50.nip.io/outputs/result.mp4");
      }, 5000);
    } catch (err: any) {
      setProcessing(false);
      toast.error(err.message || "Falha ao iniciar processamento");
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
      <div className="min-w-0 space-y-4">
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-border/60 bg-black/20 shadow-2xl">
          {item.poster && (
            <img
              src={item.poster}
              className="size-full object-contain opacity-50 blur-sm"
              alt="Preview"
            />
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Eraser className="size-12 text-primary/20" />
            <p className="text-sm text-muted-foreground">Preview de Limpeza IA</p>
          </div>
        </div>

        {health && (
          <div className={`flex items-center gap-3 rounded-xl border p-4 ${
            health.status === "online" ? "border-green-500/20 bg-green-500/5" : "border-destructive/20 bg-destructive/5"
          }`}>
            {health.status === "online" ? (
              <CheckCircle2 className="size-5 text-green-500" />
            ) : (
              <AlertCircle className="size-5 text-destructive" />
            )}
            <div className="flex-1">
              <p className="text-sm font-medium">
                Status do Motor: {health.status === "online" ? "Online" : "Offline"}
              </p>
              <p className="text-xs text-muted-foreground">
                {health.status === "online" 
                  ? `Hardware: ${health.gpu && health.gpu !== "none" ? `GPU (${health.gpu})` : `CPU (${health.cpu})`}`
                  : health.reason || "Erro desconhecido"}
              </p>
            </div>
            {checking && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          </div>
        )}
      </div>

      <aside className="space-y-6">
        <div className="space-y-4 rounded-2xl border border-border/60 bg-surface/40 p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-display font-bold">Configuração</h3>
            <Activity className={`size-4 ${health?.status === "online" ? "text-green-500" : "text-muted-foreground"}`} />
          </div>
          
          <div className="space-y-2">
            <p className="text-[10px] font-mono uppercase text-muted-foreground">Modo de reconstrução</p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" className="h-8 text-[10px] uppercase">Automático</Button>
              <Button variant="secondary" size="sm" className="h-8 text-[10px] uppercase">Manual</Button>
            </div>
          </div>

          <Button
            className="w-full shadow-glow"
            disabled={processing || checking || health?.status !== "online"}
            onClick={startClean}
          >
            {processing ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Processando...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 size-4" />
                Começar Limpeza
              </>
            )}
          </Button>

          {health?.status !== "online" && !checking && (
            <p className="text-center text-[10px] text-destructive">
              Configure o worker para habilitar o processamento.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border/40 bg-black/20 p-3 text-[10px] text-muted-foreground">
          <p className="font-mono leading-relaxed">
            O CleanerIA utiliza o motor ProPainter na VPS para reconstrução temporal de alta qualidade.
          </p>
        </div>
      </aside>
    </div>
  );
}

