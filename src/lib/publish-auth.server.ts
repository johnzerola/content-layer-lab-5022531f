import { timingSafeEqual } from "node:crypto";

export function validCronSecret(
  authorization: string | null,
  configuredSecret = process.env["PUBLISH_CRON_SECRET"] ?? process.env["PUBLISH_HOOK_SECRET"],
): boolean {
  if (!configuredSecret || configuredSecret.length < 32 || !authorization?.startsWith("Bearer ")) return false;
  const provided = authorization.slice("Bearer ".length);
  const expectedBuffer = Buffer.from(configuredSecret);
  const providedBuffer = Buffer.from(provided);
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}
export function requireCronAuthorization(request: Request): Response | null {
  if (validCronSecret(request.headers.get("authorization"))) return null;
  return Response.json({ ok: false, error: "Não autorizado." }, { status: 401 });
}
