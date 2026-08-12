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
        try {
          const url = new URL(request.url);
          const jobId = url.searchParams.get("job") ?? "";
          const token = request.headers.get("x-job-token") ?? "";
          
          if (!/^[0-9a-f-]{36}$/i.test(jobId) || !token) {
            return new Response("bad request", { status: 400 });
          }
          
          const base = workerPublicBase();
          if (!base) return new Response("worker offline", { status: 503 });

          const contentType = request.headers.get("content-type") || "";
          
          // O motor GPU espera multipart/form-data. Se recebermos binário bruto (stream),
          // precisamos envolver em FormData.
          let body: any;
          let headers: Record<string, string> = {
            "x-job-token": token,
          };

          if (!contentType.includes("multipart/form-data")) {
            // Em ambientes de borda, o body (ReadableStream) pode ter limitações com duplex: 'half'
            // se misturado com transformações complexas. Vamos tentar ler como arrayBuffer para estabilidade.
            const buffer = await request.arrayBuffer();
            const formData = new FormData();
            formData.append("file", new Blob([buffer]), "video.mp4");
            body = formData;
          } else {
            // Repasse direto de form-data
            body = await request.formData();
          }

          const upstream = await fetch(`${base}/v1/jobs/${jobId}/upload`, {
            method: "POST",
            headers,
            body,
          });

          const text = await upstream.text();
          return new Response(text, { 
            status: upstream.status,
            headers: { "Content-Type": "application/json" }
          });
        } catch (error: any) {
          console.error("Cleaner Upload Proxy Error:", error);
          return new Response(JSON.stringify({ error: error.message }), { 
            status: 500,
            headers: { "Content-Type": "application/json" }
          });
        }
      },
    },
  },
});
