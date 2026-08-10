import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  RotateCcw,
  Stethoscope,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import {
  TOOL_LABEL,
  clearFinishedJobs,
  downloadSessionLog,
  isStalled,
  jobCancel,
  jobCounts,
  jobRetry,
  listJobs,
  removeJob,
  subscribeJobs,
  type Job,
} from "@/lib/jobs";
import { runDiagnostics, type Diagnostics } from "@/lib/diagnostics";

const STATUS_STYLE: Record<string, string> = {
  "na fila": "border-border bg-surface-2 text-muted-foreground",
  processando: "border-primary/40 bg-primary/12 text-primary",
  pronto: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  erro: "border-red-500/40 bg-red-500/10 text-red-400",
  cancelado: "border-border bg-surface-2 text-muted-foreground",
};

function secs(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function JobRow({ job, now }: { job: Job; now: number }) {
  const [open, setOpen] = useState(false);
  const stalled = isStalled(job, now);
  const retry = jobRetry(job.id);
  const cancel = jobCancel(job.id);
  const elapsed = (job.endedAt ?? now) - job.startedAt;

  return (
    <li className="rounded-xl border border-border bg-surface-2/60 p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5">
          {job.status === "processando" ? (
            stalled ? (
              <AlertTriangle className="size-4 text-amber-400" />
            ) : (
              <Loader2 className="size-4 animate-spin text-primary" />
            )
          ) : job.status === "pronto" ? (
            <CheckCircle2 className="size-4 text-emerald-400" />
          ) : job.status === "erro" ? (
            <XCircle className="size-4 text-red-400" />
          ) : (
            <Activity className="size-4 text-muted-foreground" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{job.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {TOOL_LABEL[job.tool]} · {job.stage} · {secs(elapsed)}
            {job.safeMode ? " · modo seguro" : ""}
          </p>
          {job.status === "processando" && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
              <div
                className={`h-full rounded-full transition-[width] ${stalled ? "bg-amber-400" : "bg-primary"}`}
                style={{ width: `${Math.round(job.progress * 100)}%` }}
              />
            </div>
          )}
          {job.error && <p className="mt-1 text-xs text-red-400">{job.error}</p>}
          {stalled && (
            <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">
              Sem progresso há {secs(now - job.updatedAt)}. Pode estar travado.
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setOpen((v) => !v)}
              className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground"
            >
              {open ? "ocultar etapas" : `etapas (${job.steps.length})`}
            </button>
            {retry && (job.status === "erro" || stalled) && (
              <button
                onClick={() => retry(true)}
                className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-2 py-1 text-xs text-primary transition hover:bg-primary/20"
              >
                <RotateCcw className="size-3.5" /> reprocessar em modo seguro
              </button>
            )}
            {cancel && (job.status === "processando" || stalled) && (
              <button
                onClick={() => cancel()}
                className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground transition hover:text-foreground"
              >
                cancelar
              </button>
            )}
            <button
              onClick={() => removeJob(job.id)}
              aria-label="Remover do histórico"
              className="ml-auto rounded-lg border border-border p-1 text-muted-foreground transition hover:text-foreground"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>

          {open && (
            <ol className="mt-2 space-y-1 border-l border-border pl-3 text-xs text-muted-foreground">
              {job.steps.map((s, i) => (
                <li key={`${s.label}-${i}`} className="flex justify-between gap-3">
                  <span className="truncate">{s.label}</span>
                  <span className="shrink-0 font-mono">
                    +{secs(s.at)}
                    {s.ms !== undefined ? ` · ${secs(s.ms)}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </li>
  );
}

function DiagnosticsTab() {
  const [diag, setDiag] = useState<Diagnostics | null>(null);

  useEffect(() => {
    void runDiagnostics().then(setDiag);
  }, []);

  if (!diag) {
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> testando o navegador…
      </p>
    );
  }

  return (
    <div className="space-y-3 p-4">
      {diag.fallbackReason ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          {diag.fallbackReason}
        </p>
      ) : (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
          Tudo pronto para exportar em MP4 (H.264).
        </p>
      )}

      <ul className="space-y-2">
        {diag.rows.map((r) => (
          <li key={r.id} className="flex items-start gap-2 rounded-xl border border-border bg-surface-2/60 p-3">
            {r.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-red-400" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{r.label}</p>
              <p className="break-words text-xs text-muted-foreground">{r.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <dt className="text-muted-foreground">Núcleos de CPU</dt>
          <dd className="text-sm font-medium text-foreground">{diag.cores || "—"}</dd>
        </div>
        <div className="rounded-xl border border-border bg-surface-2/60 p-3">
          <dt className="text-muted-foreground">Memória usada</dt>
          <dd className="text-sm font-medium text-foreground">
            {diag.memoryMb !== null ? `${diag.memoryMb} MB` : "não informado"}
          </dd>
        </div>
        <div className="col-span-2 rounded-xl border border-border bg-surface-2/60 p-3">
          <dt className="text-muted-foreground">Armazenamento do navegador</dt>
          <dd className="text-sm font-medium text-foreground">
            {diag.storageMb ? `${diag.storageMb.used} MB de ${diag.storageMb.quota} MB` : "não informado"}
          </dd>
        </div>
      </dl>

      <button
        onClick={() => void runDiagnostics().then(setDiag)}
        className="w-full rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
      >
        testar de novo
      </button>
    </div>
  );
}

/** Central de atividade + diagnóstico, disponível em todas as telas. */
export function ActivityDock() {
  const [jobs, setJobs] = useState<Job[]>(() => listJobs());
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"jobs" | "diag">("jobs");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => subscribeJobs(setJobs), []);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const counts = useMemo(() => jobCounts(jobs), [jobs]);

  // avisa uma vez quando um render trava
  useEffect(() => {
    const stalled = jobs.filter((j) => isStalled(j, now));
    for (const j of stalled) {
      if (j.meta["warned"]) continue;
      j.meta["warned"] = true;
      toast.warning(`"${j.name}" parece travado`, {
        id: `stall-${j.id}`,
        description: "Abra a central de atividade para reprocessar em modo seguro.",
        action: { label: "abrir", onClick: () => setOpen(true) },
      });
    }
  }, [jobs, now]);

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Central de atividade"
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-border bg-surface px-4 py-2.5 text-sm text-foreground shadow-lg backdrop-blur transition hover:bg-surface-2"
      >
        {counts.running > 0 ? (
          <Loader2 className="size-4 animate-spin text-primary" />
        ) : counts.stalled > 0 || counts.failed > 0 ? (
          <AlertTriangle className="size-4 text-amber-400" />
        ) : (
          <Activity className="size-4 text-muted-foreground" />
        )}
        <span className="hidden sm:inline">Atividade</span>
        {counts.running + counts.failed > 0 && (
          <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
            {counts.running + counts.failed}
          </span>
        )}
      </button>

      {open && (
        <aside className="fixed bottom-20 right-4 z-40 flex max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl">
          <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <div className="flex rounded-xl border border-border bg-surface-2 p-0.5">
              <button
                onClick={() => setTab("jobs")}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  tab === "jobs" ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                }`}
              >
                Atividade
              </button>
              <button
                onClick={() => setTab("diag")}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  tab === "diag" ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                }`}
              >
                <Stethoscope className="size-3.5" /> Diagnóstico
              </button>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Fechar central de atividade"
              className="ml-auto rounded-lg p-1.5 text-muted-foreground transition hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "diag" ? (
              <DiagnosticsTab />
            ) : jobs.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                Nada processando. O que você exportar em qualquer ferramenta aparece aqui.
              </p>
            ) : (
              <ul className="space-y-2 p-3">
                {jobs.map((j) => (
                  <JobRow key={j.id} job={j} now={now} />
                ))}
              </ul>
            )}
          </div>

          {tab === "jobs" && jobs.length > 0 && (
            <footer className="flex gap-2 border-t border-border p-3">
              <button
                onClick={() => downloadSessionLog()}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground"
              >
                <Download className="size-3.5" /> baixar log (JSON)
              </button>
              <button
                onClick={clearFinishedJobs}
                className="rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground transition hover:text-foreground"
              >
                limpar concluídos
              </button>
            </footer>
          )}
        </aside>
      )}
    </>
  );
}
