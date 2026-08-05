import { createServerFn } from "@tanstack/react-start";

/**
 * Transcreve um trecho de áudio (WAV base64) usando a Lovable AI.
 * Retorna apenas o texto — os tempos são calculados no cliente por segmento.
 */
export const transcribeChunk = createServerFn({ method: "POST" })
  .inputValidator((input: { audio: string; language?: string }) => {
    if (!input?.audio || typeof input.audio !== "string") throw new Error("áudio ausente");
    return input;
  })
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("LOVABLE_API_KEY ausente");

    const bin = Uint8Array.from(atob(data.audio), (c) => c.charCodeAt(0));
    if (bin.byteLength < 2048) return { text: "" };

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
      throw new Error(`transcrição falhou [${res.status}]: ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as { text?: string };
    return { text: json.text ?? "" };
  });
