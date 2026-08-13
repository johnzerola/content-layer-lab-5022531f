import { createServerFn } from "@tanstack/react-start";

/**
 * Traduz as palavras da legenda mantendo a mesma quantidade de itens,
 * para que os tempos por palavra continuem válidos (estilo Clipzi).
 */
export const translateWords = createServerFn({ method: "POST" })
  .validator((input: { words: string[]; language: string }) => {
    if (!Array.isArray(input?.words) || input.words.length === 0) throw new Error("nada para traduzir");
    if (input.words.length > 1200) throw new Error("Trecho grande demais para traduzir de uma vez.");
    if (!input?.language) throw new Error("idioma ausente");
    return input;
  })
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) throw new Error("A IA de tradução não está configurada neste projeto (chave ausente).");

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "Você traduz legendas palavra a palavra. Receba um array JSON de tokens e devolva SOMENTE um array JSON " +
              "com exatamente a mesma quantidade de itens, traduzidos para o idioma pedido, mantendo a ordem. " +
              "Nunca junte nem remova itens; se um token não tiver tradução isolada, repita algo curto equivalente.",
          },
          {
            role: "user",
            content: `Idioma de destino: ${data.language}\nTokens: ${JSON.stringify(data.words)}`,
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg =
        res.status === 402
          ? "Seus créditos de IA acabaram. Adicione créditos em Settings → Plans & credits para traduzir."
          : res.status === 429
            ? "Muitas traduções ao mesmo tempo. Espere alguns segundos e tente de novo."
            : `Falha na tradução (${res.status}). ${body.slice(0, 160)}`;
      throw new Error(msg);
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content ?? "";
    const match = raw.match(/\[[\s\S]*\]/);
    let out: unknown = null;
    try {
      out = JSON.parse(match ? match[0] : raw);
    } catch {
      out = null;
    }
    if (!Array.isArray(out)) throw new Error("A IA devolveu a tradução em formato inesperado. Tente novamente.");
    const words = out.map((w) => String(w ?? "").trim());
    // garante o mesmo tamanho: sobra é ignorada, falta usa o original
    const fixed = data.words.map((orig, i) => words[i] || orig);
    return { words: fixed };
  });
