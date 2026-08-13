import { createServerFn } from "@tanstack/react-start";

/**
 * Transcreve um trecho de áudio (WAV base64) usando a Lovable AI.
 * Retorna apenas o texto — os tempos são calculados no cliente por segmento.
 */
export const transcribeChunk = createServerFn({ method: "POST" })
  .validator((input: { audio: string; language?: string }) => {
    if (!input?.audio || typeof input.audio !== "string") throw new Error("áudio ausente");
    return input;
  })
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("A IA de transcrição não está configurada neste projeto (chave ausente).");

    const bin = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
    if (bin.byteLength < 2048) return { text: "" };
    if (bin.byteLength > 24 * 1024 * 1024) {
      throw new Error("Trecho de áudio grande demais para transcrever. Reduza a duração do corte.");
    }

    const form = new FormData();
    form.append("model", "openai/gpt-4o-transcribe");
    form.append("file", new Blob([bin], { type: "audio/wav" }), "chunk.wav");
    if (data.language) form.append("language", data.language);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg =
        res.status === 402
          ? "Seus créditos de IA acabaram. Adicione créditos em Settings → Plans & credits para gerar legendas."
          : res.status === 429
            ? "Muitas transcrições ao mesmo tempo (limite de uso). Espere alguns segundos e tente novamente."
            : res.status === 403 || res.status === 404
              ? "A transcrição por IA está indisponível nesta conta."
              : res.status === 400
                ? "O áudio enviado foi recusado pela IA (formato ou idioma inválido). Tente o idioma 'auto'."
                : `Falha na transcrição (${res.status}). ${body.slice(0, 160)}`;
      throw new Error(msg);
    }


    const json = (await res.json()) as { text?: string };
    return { text: json.text ?? "" };
  });
