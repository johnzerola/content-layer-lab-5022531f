/**
 * Ponte HTTP entre o app e o worker GPU (`worker/`).
 * Só roda no servidor — nunca importado por componente.
 */
import { createHmac } from "crypto";
import type { CleanerRegion } from "@/lib/cleaner";

export function workerBase(): string | null {
  const url = process.env["CLEANER_WORKER_URL"];
  return url ? url.replace(/\/+$/, "") : null;
}

/**
 * URL usada pelo navegador (upload direto). Precisa ser HTTPS, senão o browser
 * bloqueia por conteúdo misto. Cai para a URL interna quando não configurada.
 */
export function workerPublicBase(): string | null {
  const url = process.env["CLEANER_WORKER_PUBLIC_URL"];
  return url ? url.replace(/\/+$/, "") : workerBase();
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

async function call<T>(path: string, init: RequestInit & { jobId?: string } = {}): Promise<T> {
  const base = workerBase();
  if (!base) throw new Error("worker-offline");
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (init.jobId) headers.set("x-job-token", jobToken(init.jobId));
  const res = await fetch(`${base}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 400) || `worker ${res.status}`);
  return (text ? JSON.parse(text) : {}) as T;
}

export async function workerHealth() {
  const base = workerBase();
  if (!base) return { online: false as const, reason: "CLEANER_WORKER_URL não configurada" };
  try {
    const info = await call<{ gpu: string; engines: string[]; version: string }>("/v1/health");
    return { online: true as const, ...info };
  } catch (e) {
    return { online: false as const, reason: e instanceof Error ? e.message : "sem resposta" };
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
