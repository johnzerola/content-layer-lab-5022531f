import { createFileRoute } from "@tanstack/react-router";
import { workerPublicBase } from "@/lib/cleaner.server";

/**
 * Fallback de upload: alguns provedores de rede/DNS do usuário não alcançam o
 * domínio do worker. Nesse caso o navegador envia para a nossa própria origem
 * e nós repassamos o arquivo para o motor GPU. O token do job continua sendo
 * validado pelo worker, então esta rota não expõe nada.
 */
export const Route = createFileRoute("/api/public/cleaner-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const jobId = url.searchParams.get("job") ?? "";
        const token = request.headers.get("x-job-token") ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(jobId) || !token) {
          return new Response("bad request", { status: 400 });
        }
        const base = workerPublicBase();
        if (!base) return new Response("worker offline", { status: 503 });

        const formData = new FormData();
        // O motor espera o arquivo no campo 'file'
        const blob = await request.blob();
        formData.append("file", blob, "video.mp4");

        const upstream = await fetch(`${base}/v1/jobs/${jobId}/upload`, {
          method: "POST",
          headers: {
            "x-job-token": token,
          },
          body: formData,
        });
        const text = await upstream.text();
        return new Response(text, { status: upstream.status });
      },
    },
  },
});
