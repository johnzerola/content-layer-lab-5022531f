import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  CalendarClock,
  Instagram,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Clock,
} from "lucide-react";
import {
  listAccounts,
  schedulePost,
  uploadPostVideo,
  type SocialAccount,
  type PostKind,
} from "@/lib/social";
import { toast } from "sonner";

// I need to check the exact path for Dialog components in this project.
// Based on typical shadcn structures:
// import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

interface AutoScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: { blob: Blob; fileName: string; headline?: string }[];
  onComplete: () => void;
}

export function AutoScheduleModal({
  open,
  onOpenChange,
  items,
  onComplete,
}: AutoScheduleModalProps) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [kind, setKind] = useState<PostKind>("reels");
  const [baseCaption, setBaseCaption] = useState("");
  const [intervalType, setIntervalType] = useState<"hours" | "days">("hours");
  const [intervalValue, setIntervalValue] = useState(2);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1, 0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<"idle" | "processing" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (open) {
      listAccounts().then(setAccounts).catch(() => toast.error("Erro ao carregar contas."));
    }
  }, [open]);

  useEffect(() => {
    if (accounts.length > 0 && !accountId) {
      const first = accounts[0];
      if (first) setAccountId(first.id);
    }
  }, [accounts, accountId]);

  const handleSchedule = async () => {
    if (!accountId) {
      toast.error("Selecione uma conta para agendar.");
      return;
    }

    setLoading(true);
    setStatus("processing");
    setProgress(0);
    setErrorMsg("");

    try {
      const start = new Date(startDate);
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item) continue;

        const scheduledAt = new Date(start);
        
        if (intervalType === "hours") {
          scheduledAt.setHours(start.getHours() + (i * intervalValue));
        } else {
          scheduledAt.setDate(start.getDate() + (i * intervalValue));
        }

        // Upload
        const up = await uploadPostVideo(item.blob, item.fileName);
        
        // Schedule
        await schedulePost({
          accountId,
          kind,
          caption: item.headline || baseCaption,
          scheduledAt,
          videoPath: up.path,
          videoUrl: up.url,
          fileName: item.fileName,
        });

        setProgress(Math.round(((i + 1) / items.length) * 100));
      }

      setStatus("success");
      toast.success(`${items.length} publicações agendadas com sucesso!`);
      setTimeout(() => {
        onOpenChange(false);
        onComplete();
      }, 2000);
    } catch (err) {
      console.error(err);
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Ocorreu um erro no agendamento.");
      toast.error("Falha ao agendar lote.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-primary" />
            Agendamento Automático
          </DialogTitle>
          <DialogDescription>
            Programe todos os {items.length} vídeos para serem publicados automaticamente.
          </DialogDescription>
        </DialogHeader>

        {status === "idle" || status === "error" ? (
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Conta de destino</label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Selecione uma conta</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    @{acc.username} ({acc.platform})
                  </option>
                ))}
              </select>
              {accounts.length === 0 && (
                <p className="text-[10px] text-destructive">Nenhuma conta conectada. Vá para Agenda primeiro.</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Formato</label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as PostKind)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="reels">Reels</option>
                  <option value="feed">Feed</option>
                  <option value="stories">Stories</option>
                </select>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Início</label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Intervalo entre posts</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={1}
                  value={intervalValue}
                  onChange={(e) => setIntervalValue(parseInt(e.target.value) || 1)}
                  className="flex h-10 w-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <select
                  value={intervalType}
                  onChange={(e) => setIntervalType(e.target.value as "hours" | "days")}
                  className="flex h-10 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="hours">Horas</option>
                  <option value="days">Dias</option>
                </select>
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Legenda base (opcional)</label>
              <textarea
                value={baseCaption}
                onChange={(e) => setBaseCaption(e.target.value)}
                placeholder="Usada se o vídeo não tiver headline..."
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            {status === "error" && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-destructive">
                <AlertCircle className="size-4 shrink-0" />
                <p className="text-xs">{errorMsg}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            {status === "processing" ? (
              <>
                <Loader2 className="mb-4 size-10 animate-spin text-primary" />
                <p className="text-sm font-medium">Agendando publicações...</p>
                <p className="mt-1 text-xs text-muted-foreground">{progress}% concluído</p>
                <div className="mt-4 h-2 w-full max-w-[300px] overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </>
            ) : (
              <>
                <CheckCircle2 className="mb-4 size-10 text-emerald-500" />
                <p className="text-sm font-medium">Sucesso!</p>
                <p className="mt-1 text-xs text-muted-foreground">Tudo programado na sua agenda.</p>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          {status === "idle" || status === "error" ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
                Cancelar
              </Button>
              <Button onClick={handleSchedule} disabled={loading || accounts.length === 0}>
                {loading ? "Processando..." : "Confirmar Agendamento"}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
