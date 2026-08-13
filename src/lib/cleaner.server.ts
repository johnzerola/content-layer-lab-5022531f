import { createHmac, timingSafeEqual } from "crypto";
import { getRequest } from "@tanstack/react-start/server";
import type { CleanerRegion } from "@/lib/cleaner";

type JobTokenScope = "upload" | "control" | "result";
type ServiceTokenScope = "media";
type MediaHeaders = Record<string, string>;

export function appOrigin(): string {
  const configuredUrl = process.env["PUBLIC_SITE_URL"];
  if (configuredUrl) return configuredUrl.replace(/\/+$/, "");
  try {
    const request = getRequest();
    const proto =
      request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (host) return `${proto}://${host}`;
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

function normalizeBase(url: string): string {
  const clean = url.replace(/\/+$/, "");
  const match = /^https?:\/\/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d+)?$/.exec(clean);
  if (!match) return clean;
  return `https://cleaner-${match[1]}-${match[2]}-${match[3]}-${match[4]}.nip.io`;
}

export function workerBase(): string | null {
  const url = process.env["CLEANER_WORKER_URL"];
  return url ? normalizeBase(url) : null;
}

export function workerPublicBase(): string | null {
  const url = process.env["CLEANER_WORKER_PUBLIC_URL"];
  return url ? normalizeBase(url) : workerBase();
}

function secret(): string {
  const value = process.env["CLEANER_WORKER_SECRET"] ?? "";
  if (value.length < 32 || value === "default_secret") {
    throw new Error("CLEANER_WORKER_SECRET ausente ou fraco");
  }
  return value;
}

export function jobToken(jobId: string, scope: JobTokenScope, ttlSeconds = 60 * 60): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `v2.${jobId}.${expires}.${scope}`;
  const signature = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function serviceToken(scope: ServiceTokenScope, ttlSeconds = 60): string {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `v2.service.${expires}.${scope}`;
  const signature = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

export function mediaProxyTicket(url: string, headers: MediaHeaders = {}, ttlSeconds = 10 * 60) {
  const safeHeaders = Object.fromEntries(
    Object.entries(headers).filter(
      ([key, value]) => ["user-agent", "referer", "origin"].includes(key.toLowerCase()) && value.length <= 1000,
    ),
  );
  const payload = Buffer.from(
    JSON.stringify({ url, headers: safeHeaders, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret()).update(`media.${payload}`).digest("hex");
  return `${payload}.${signature}`;
}

export function verifyMediaProxyTicket(ticket: string | null): {
  url: string;
  headers: MediaHeaders;
} | null {
  if (!ticket || ticket.length > 12_000) return null;
  const [payload, supplied, extra] = ticket.split(".");
  if (!payload || !supplied || extra || !/^[0-9a-f]{64}$/i.test(supplied)) return null;
  const expected = createHmac("sha256", secret()).update(`media.${payload}`).digest("hex");
  if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      url?: unknown;
      headers?: unknown;
      exp?: unknown;
    };
    if (
      typeof parsed.url !== "string" ||
      typeof parsed.exp !== "number" ||
      parsed.exp < Math.floor(Date.now() / 1000) ||
      !parsed.headers ||
      typeof parsed.headers !== "object"
    ) {
      return null;
    }
    const headers = Object.fromEntries(
      Object.entries(parsed.headers as Record<string, unknown>).filter(
        ([key, value]) =>
          ["user-agent", "referer", "origin"].includes(key.toLowerCase()) &&
          typeof value === "string" &&
          value.length <= 1000,
      ),
    ) as MediaHeaders;
    return { url: parsed.url, headers };
  } catch {
    return null;
  }
}

export function workerResultUrl(pathOrUrl: unknown): string | null {
  if (typeof pathOrUrl !== "string" || !pathOrUrl) return null;
  const base = workerPublicBase() ?? workerBase();
  if (!base) return null;
  let result: URL;
  try {
    result = new URL(pathOrUrl, `${base}/`);
    if (result.origin !== new URL(base).origin) return null;
  } catch {
    return null;
  }
  const match = /^\/v1\/jobs\/([0-9a-f-]{36})\/result$/i.exec(result.pathname);
  if (!match?.[1]) return null;
  result.searchParams.set("token", jobToken(match[1], "result", 60 * 60 * 72));
  return result.toString();
}

export function verifyCallback(
  body: string,
  signature: string | null,
  timestamp: string | null,
): boolean {
  if (!signature || !timestamp || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) return false;
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret()).update(`${timestamp}.${body}`).digest("hex");
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}

async function call<T>(path: string, init: RequestInit & { jobId?: string } = {}): Promise<T> {
  const base = workerBase();
  if (!base) throw new Error("worker-offline");
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (init.jobId) headers.set("x-job-token", jobToken(init.jobId, "control"));
  const response = await fetch(`${base}${path}`, { ...init, headers });
  if (!response.ok) {
    const responseBody = await response.text();
    throw new Error(responseBody.slice(0, 400) || `worker ${response.status}`);
  }
  const responseBody = await response.text();
  return (responseBody ? JSON.parse(responseBody) : {}) as T;
}

export async function workerHealth() {
  const base = workerBase();
  if (!base) return { online: false as const, reason: "CLEANER_WORKER_URL nao configurada" };
  try {
    const response = await fetch(`${base}/v1/health`);
    const responseBody = await response.text();
    if (!response.ok) {
      return {
        online: false as const,
        reason: responseBody.slice(0, 100) || `worker ${response.status}`,
      };
    }
    return { online: true as const, ...(JSON.parse(responseBody) as Record<string, unknown>) };
  } catch (error: unknown) {
    return {
      online: false as const,
      reason: error instanceof Error ? error.message : "sem resposta",
    };
  }
}

export async function workerResolveMedia(url: string) {
  const base = workerBase();
  if (!base) throw new Error("worker-offline");
  const response = await fetch(`${base}/v1/media/resolve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-service-token": serviceToken("media"),
    },
    body: JSON.stringify({ url }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(body.slice(0, 400) || `worker ${response.status}`);
  return JSON.parse(body) as {
    url: string;
    headers: MediaHeaders;
    title?: string;
    thumbnail?: string | null;
    source?: string;
    ext?: string;
    duration?: number;
    size?: number;
  };
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
  const status = await call<Record<string, unknown>>(`/v1/jobs/${jobId}`, { jobId });
  if (status["result_url"]) status["result_url"] = workerResultUrl(status["result_url"]);
  if (status["preview_url"]) status["preview_url"] = workerResultUrl(status["preview_url"]);
  return status;
}

export async function workerCancel(jobId: string) {
  return call<{ ok: boolean }>(`/v1/jobs/${jobId}/cancel`, { method: "POST", jobId });
}

export async function workerDelete(jobId: string) {
  return call<{ ok: boolean }>(`/v1/jobs/${jobId}`, { method: "DELETE", jobId });
}
