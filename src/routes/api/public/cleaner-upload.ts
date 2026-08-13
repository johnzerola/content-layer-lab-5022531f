import { createFileRoute } from "@tanstack/react-router";
import { workerPublicBase } from "@/lib/cleaner.server";

export const Route = createFileRoute("/api/public/cleaner-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const configuredMax = Number(process.env["CLEANER_MAX_UPLOAD_GB"] ?? "2");
          const maxBytes =
            Math.max(0.05, Number.isFinite(configuredMax) ? configuredMax : 2) * 1024 ** 3;
          const url = new URL(request.url);
          const jobId = url.searchParams.get("job") ?? "";
          const token = request.headers.get("x-job-token") ?? "";
          if (!/^[0-9a-f-]{36}$/i.test(jobId) || !token) {
            return new Response("bad request", { status: 400 });
          }

          const claimedSize = Number(request.headers.get("x-file-size") ?? "0");
          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (
            (claimedSize > 0 && claimedSize > maxBytes) ||
            (contentLength > 0 && contentLength > maxBytes + 2 * 1024 * 1024)
          ) {
            return new Response("payload too large", { status: 413 });
          }

          const base = workerPublicBase();
          if (!base) return new Response("worker offline", { status: 503 });
          const upstream = await fetch(`${base}/v1/jobs/${jobId}/upload`, {
            method: "POST",
            headers: {
              "content-type": request.headers.get("content-type") || "application/octet-stream",
              "x-job-token": token,
              ...(claimedSize > 0 ? { "x-file-size": String(claimedSize) } : {}),
            },
            body: request.body,
          });
          return new Response(await upstream.text(), {
            status: upstream.status,
            headers: { "Content-Type": upstream.headers.get("content-type") || "application/json" },
          });
        } catch (error: unknown) {
          console.error("Cleaner Upload Proxy Error:", error);
          return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : "upload failed" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
