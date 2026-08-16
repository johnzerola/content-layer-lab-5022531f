/**
 * Central de atividade: uma fila global compartilhada por todas as
 * ferramentas (ViralBatch, CorteIA, LimpaVídeo e Monitora Live).
 *
 * Cada trabalho guarda etapas com carimbo de tempo, o que dá dois ganhos:
 * um painel único de "processando / pronto / falhou" e um log de sessão
 * exportável em JSON para depurar renderizações lentas ou travadas.
 */

export type JobTool = "lote" | "clip" | "limpar" | "limpar-ia" | "live";
export type JobStatus = "na fila" | "processando" | "pronto" | "erro" | "cancelado";

export type NextAction = {
  type: "schedule";
  accountId: string;
  kind: "reels" | "feed" | "stories" | "shorts";
  caption?: string;
  intervalHours?: number;
  intervalDays?: number;
};

export interface JobStep {
  label: string;
  /** ms desde o início do trabalho */
  at: number;
  /** duração da etapa (preenchida quando a próxima começa) */
  ms?: number;
}

export interface Job {
  id: string;
  tool: JobTool;
  name: string;
  status: JobStatus;
  /** 0..1 */
  progress: number;
  stage: string;
  createdAt: number;
  startedAt: number;
  updatedAt: number;
  endedAt?: number;
  error?: string;
  steps: JobStep[];
  meta: Record<string, unknown> & { nextAction?: NextAction };
  /** true quando o trabalho já rodou em modo seguro */
  safeMode?: boolean;
}

export const TOOL_LABEL: Record<JobTool, string> = {
  lote: "ViralBatch",
  clip: "CorteIA",
  limpar: "LimpaVídeo",
  "limpar-ia": "CleanerIA",
  live: "Monitora Live",
};

/** sem progresso por esse tempo enquanto processa = provavelmente travado */
export const STALL_MS = 75_000;

type Listener = (jobs: Job[]) => void;

const jobs = new Map<string, Job>();
const listeners = new Set<Listener>();
const retries = new Map<string, (safe: boolean) => void>();
const cancels = new Map<string, () => void>();

function emit() {
  const list = listJobs();
  for (const l of listeners) l(list);
}

export function subscribeJobs(fn: Listener): () => void {
  listeners.add(fn);
  fn(listJobs());
  return () => {
    listeners.delete(fn);
  };
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export function getJob(id: string) {
  return jobs.get(id);
}

export function startJob(input: {
  id?: string;
  tool: JobTool;
  name: string;
  stage?: string;
  meta?: Record<string, unknown> & { nextAction?: NextAction };
}): string {
  const now = Date.now();
  const id = input.id ?? crypto.randomUUID();
  const existing = jobs.get(id);
  jobs.set(id, {
    id,
    tool: input.tool,
    name: input.name,
    status: "na fila",
    progress: 0,
    stage: input.stage ?? "na fila",
    createdAt: existing?.createdAt ?? now,
    startedAt: now,
    updatedAt: now,
    steps: [{ label: input.stage ?? "na fila", at: 0 }],
    meta: { ...(existing?.meta ?? {}), ...(input.meta ?? {}) },
  });
  emit();
  return id;
}

export function updateJob(
  id: string,
  patch: Partial<Pick<Job, "status" | "progress" | "stage" | "error" | "safeMode">> & {
    meta?: Record<string, unknown> & { nextAction?: NextAction };
  },
) {
  const job = jobs.get(id);
  if (!job) return;
  const now = Date.now();
  if (patch.stage && patch.stage !== job.stage) {
    const last = job.steps[job.steps.length - 1];
    const at = now - job.startedAt;
    if (last) last.ms = at - last.at;
    job.steps.push({ label: patch.stage, at });
    job.stage = patch.stage;
  }
  if (patch.status) job.status = patch.status;
  if (typeof patch.progress === "number") job.progress = Math.max(0, Math.min(1, patch.progress));
  if (patch.error !== undefined) job.error = patch.error;
  if (patch.safeMode !== undefined) job.safeMode = patch.safeMode;
  if (patch.meta) job.meta = { ...job.meta, ...patch.meta };
  if (patch.status === "pronto" || patch.status === "erro" || patch.status === "cancelado") {
    job.endedAt = now;
    const last = job.steps[job.steps.length - 1];
    if (last && last.ms === undefined) last.ms = now - job.startedAt - last.at;
  }
  job.updatedAt = now;
  emit();
}

export function finishJob(id: string, stage = "pronto") {
  updateJob(id, { status: "pronto", progress: 1, stage });
}

export function failJob(id: string, error: string) {
  updateJob(id, { status: "erro", error, stage: "falhou" });
}

export function removeJob(id: string) {
  jobs.delete(id);
  retries.delete(id);
  cancels.delete(id);
  emit();
}

export function clearFinishedJobs() {
  for (const [id, j] of jobs) {
    if (j.status === "pronto" || j.status === "erro" || j.status === "cancelado") jobs.delete(id);
  }
  emit();
}

/** registra como reprocessar este item (usado pelo botão "modo seguro") */
export function setJobRetry(id: string, fn: (safe: boolean) => void) {
  retries.set(id, fn);
}
export function jobRetry(id: string) {
  return retries.get(id);
}

export function setJobCancel(id: string, fn: () => void) {
  cancels.set(id, fn);
}
export function jobCancel(id: string) {
  return cancels.get(id);
}

/** Trabalho parado: processando, mas sem qualquer atualização há muito tempo. */
export function isStalled(job: Job, now = Date.now(), limit = STALL_MS) {
  return job.status === "processando" && now - job.updatedAt > limit;
}

export function jobCounts(list = listJobs()) {
  return {
    running: list.filter((j) => j.status === "processando" || j.status === "na fila").length,
    done: list.filter((j) => j.status === "pronto").length,
    failed: list.filter((j) => j.status === "erro").length,
    stalled: list.filter((j) => isStalled(j)).length,
  };
}

/** Log da sessão em JSON — inclui etapas com tempo de cada uma. */
export function sessionLog(extra?: Record<string, unknown>) {
  return {
    exportedAt: new Date().toISOString(),
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    ...(extra ?? {}),
    jobs: listJobs().map((j) => ({
      id: j.id,
      tool: TOOL_LABEL[j.tool],
      name: j.name,
      status: j.status,
      safeMode: !!j.safeMode,
      progress: Math.round(j.progress * 100),
      error: j.error ?? null,
      startedAt: new Date(j.startedAt).toISOString(),
      endedAt: j.endedAt ? new Date(j.endedAt).toISOString() : null,
      totalMs: (j.endedAt ?? j.updatedAt) - j.startedAt,
      steps: j.steps.map((s) => ({ etapa: s.label, emMs: s.at, duracaoMs: s.ms ?? null })),
      meta: j.meta,
    })),
  };
}

export function downloadSessionLog(extra?: Record<string, unknown>) {
  const blob = new Blob([JSON.stringify(sessionLog(extra), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `vaiviral-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
