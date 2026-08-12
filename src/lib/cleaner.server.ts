/**
 * Ponte HTTP entre o app e o worker GPU (`worker/`).
 * Só roda no servidor — nunca importado por componente.
 */
import { createHmac } from "crypto";
import { getRequest } from "@tanstack/react-start/server";
import type { CleanerRegion } from "@/lib/cleaner";

export function appOrigin(): string {
  const configuredUrl = process.env["PUBLIC_SITE_URL"];
  if (configuredUrl) return configuredUrl.replace(/\/+$/, "");
  return "";
}

/**
 * O runtime de borda (Cloudflare) recusa fetch direto para IP puro em http
 * ("error code: 1003"). O worker está publicado atrás do proxy HTTPS nip.io,
 * então normalizamos http://IP:porta -> https://cleaner-<ip-com-tracos>.nip.io.
 */
function normalizeBase(url: string): string {
  const clean = url.replace(/\/+$/, "");
  const m = /^https?:\/\/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/.exec(clean);
  if (!m) return clean;
  return `https://cleaner-${m[1]}-${m[2]}-${m[3]}-${m[4]}.nip.io`;
}

export function workerBase(): string | null {
  const url = process.env["CLEANER_WORKER_URL"];
  return url ? normalizeBase(url) : null;
}

/**
 * URL usada pelo navegador (upload direto). Precisa ser HTTPS, senão o browser
 * bloqueia por conteúdo misto. Cai para a URL interna quando não configurada.
 */
export function workerPublicBase(): string | null {
  const url = process.env["CLEANER_WORKER_PUBLIC_URL"];
  return url ? normalizeBase(url) : workerBase();
}


function secret(): string {
  return process.env["CLEANER_WORKER_SECRET"] ?? "";
}

/** Token curto assinado por job — o worker valida antes de aceitar upload/consulta. */
export function jobToken(jobId: string, ttlSeconds = 60 * 60 * 6): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${jobId}.${exp}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function verifyCallback(body: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = createHmac("sha256", secret()).update(body).digest("hex");
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export class WorkerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "WorkerError";
  }
}

function friendly(status: number, raw: string): string {
  let detail = raw;
  try {
    const parsed = JSON.parse(raw);
    detail = parsed?.detail ?? parsed?.error ?? raw;
  } catch {
    /* texto puro */
  }
  if (status === 409) return "o vídeo não está no motor — reenvie o arquivo";
  if (status === 401 || status === 403) return "sessão do job expirada — reenvie o vídeo";
  if (status === 404) return "job não encontrado no motor — reenvie o vídeo";
  if (status === 413) return "vídeo grande demais para o motor";
  if (status === 422) return `o motor recusou os dados enviados (${detail?.slice(0, 120) || "formato inválido"})`;
  if (status >= 500) return `falha interna do motor (${detail?.slice(0, 160) || "sem detalhe"}) — tente novamente`;
  return detail?.slice(0, 300) || `motor respondeu ${status}`;

}

async function call<T>(path: string, init: RequestInit & { jobId?: string } = {}): Promise<T> {
  const base = workerBase();
  if (!base) throw new WorkerError(503, "motor inacessível — worker não configurado");
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (init.jobId) headers.set("x-job-token", jobToken(init.jobId));
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers });
  } catch (e: any) {
    throw new WorkerError(503, `motor inacessível (${e?.message || "sem resposta"})`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new WorkerError(res.status, friendly(res.status, text));
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}


export async function workerHealth() {
  let base: string | null = null;
  try {
    base = workerBase();
  } catch (e) {
    return { online: false as const, reason: "Erro ao resolver URL do worker" };
  }
  if (!base) return { online: false as const, reason: "CLEANER_WORKER_URL não configurada" };
  try {
    const res = await fetch(`${base}/v1/health`);
    const text = await res.text();
    if (!res.ok) {
      return { online: false as const, reason: text.slice(0, 100) || `worker ${res.status}` };
    }
    const info = JSON.parse(text);
    return { online: true as const, ...info };
  } catch (e: any) {
    return { online: false as const, reason: e?.message || "sem resposta" };
  }
}

export async function workerDetect(jobId: string, mode: string, roi?: CleanerRegion | null) {
  return call<{ regions: CleanerRegion[] }>(`/v1/jobs/${jobId}/detect`, {
    method: "POST",
    jobId,
    body: JSON.stringify({ mode, roi: roi ?? null }),
  });
}

export async function workerProcess(input: {
  jobId: string;
  mode: string;
  preset: string;
  masks: CleanerRegion[];
  options: Record<string, unknown>;
  callbackUrl: string;
}) {
  return call<{ status: string }>(`/v1/jobs/${input.jobId}/process`, {
    method: "POST",
    jobId: input.jobId,
    body: JSON.stringify(input),
  });
}

export async function workerStatus(jobId: string) {
  return call<Record<string, unknown>>(`/v1/jobs/${jobId}`, { jobId });
}

export async function workerCancel(jobId: string) {
  return call<{ ok: boolean }>(`/v1/jobs/${jobId}/cancel`, { method: "POST", jobId });
}

export async function workerInputInfo(jobId: string) {
  return call<{
    exists: boolean;
    size: number;
    readable?: boolean;
    width?: number;
    height?: number;
    error?: string;
  }>(`/v1/jobs/${jobId}/input`, { jobId });
}
