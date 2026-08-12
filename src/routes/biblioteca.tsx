import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Download, FileArchive, Film, RotateCcw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteResult, formatBytes, getBlob, listResults, storageUsage, type ResultRow } from "@/lib/session";
import { listExports, type ExportRow } from "@/lib/cloud";
import { zipStream } from "@/lib/zip";

export const Route = createFileRoute("/biblioteca")({
  head: () => ({
    meta: [
      { title: "Biblioteca de resultados — VaiViral" },
      {
        name: "description",
        content:
          "Tudo o que você já gerou em um lugar só: cortes, lotes e vídeos limpos, prontos para baixar de novo ou reeditar.",
      },
      { property: "og:title", content: "Biblioteca de resultados — VaiViral" },
      {
        property: "og:description",
        content: "Baixe de novo qualquer vídeo já exportado, filtre por ferramenta e libere espaço quando quiser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LibraryPage,
});

const MODES: { id: string; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "clip", label: "CorteIA" },
  { id: "lote", label: "ViralBatch" },
  { id: "limpar", label: "LimpaVídeo" },
  { id: "limpar-ia", label: "CleanerIA" },
];

const modeLabel = (m: string) => MODES.find((x) => x.id === m)?.label ?? m;
const fmtDate = (ts: number) => new Date(ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function LibraryPage() {
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [cloud, setCloud] = useState<ExportRow[]>([]);
  const [mode, setMode] = useState("todos");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [zipping, setZipping] = useState(false);

  const refresh = useCallback(async () => {
    setRows(await listResults());
    setUsage(await storageUsage());
    try {
      setCloud(await listExports(60));
    } catch {
      setCloud([]);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (mode === "todos" || r.mode === mode) && (!q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase())),
      ),
    [rows, mode, q],
  );

  /** arquivos que existem só no histórico da nuvem (gerados em outro dispositivo) */
  const cloudOnly = useMemo(() => {
    const local = new Set(rows.map((r) => r.name));
    return cloud.filter((c) => !local.has(c.file_name) && (mode === "todos" || c.mode === mode));
  }, [cloud, rows, mode]);

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const download = async (r: ResultRow) => {
    const blob = await getBlob(r.blobKey);
    if (!blob) {
      toast.error("Arquivo indisponível", { description: "o vídeo foi apagado do armazenamento local" });
      return;
    }
    downloadBlob(blob, r.name);
  };

  const downloadZip = async () => {
    const list = filtered.filter((r) => sel.has(r.id));
    if (!list.length) return;
    setZipping(true);
    try {
      const files: { name: string; blob: Blob }[] = [];
      for (const r of list) {
        const blob = await getBlob(r.blobKey);
        if (blob) files.push({ name: r.name, blob });
      }
      if (!files.length) {
        toast.error("Nenhum arquivo disponível para baixar");
        return;
      }
      const zip = await zipStream(files);
      downloadBlob(zip, `vaiviral-biblioteca-${Date.now()}.zip`);
    } catch (err) {
      toast.error("Não consegui montar o ZIP", { description: String((err as Error)?.message ?? err) });
    } finally {
      setZipping(false);
    }
  };

  const removeSelected = async () => {
    const list = filtered.filter((r) => sel.has(r.id));
    for (const r of list) await deleteResult(r.id);
    setSel(new Set());
    await refresh();
    toast.success(`${list.length} arquivo(s) removidos`);
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/" className="mono-label inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> voltar
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">Biblioteca de resultados</h1>
          <p className="text-sm text-muted-foreground">
            Tudo que você já exportou — baixe de novo quando precisar.
            {usage && ` Usando ${formatBytes(usage.usage)} do navegador.`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          <RotateCcw className="mr-1 size-3.5" /> Atualizar
        </Button>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              mode === m.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
            }`}
          >
            {m.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2 rounded-lg border border-border px-2 py-1">
          <Search className="size-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="buscar pelo nome"
            className="w-44 bg-transparent text-sm outline-none"
          />
        </div>
      </div>

      {sel.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{sel.size} selecionado(s)</span>
          <Button size="sm" onClick={() => void downloadZip()} disabled={zipping}>
            <FileArchive className="mr-1 size-3.5" /> {zipping ? "Compactando…" : "Baixar ZIP"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void removeSelected()}>
            <Trash2 className="mr-1 size-3.5" /> Apagar
          </Button>
        </div>
      )}

      {filtered.length === 0 && cloudOnly.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <Film className="mx-auto mb-3 size-8 text-muted-foreground" />
          <p className="font-medium">Nada por aqui ainda</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Gere seu primeiro vídeo em CorteIA ou ViralBatch — ao terminar, ele aparece aqui para baixar quando quiser.
          </p>
          <Link to="/" className="mt-4 inline-block">
            <Button size="sm">Ir para as ferramentas</Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => (
            <div
              key={r.id}
              className={`overflow-hidden rounded-xl border transition ${
                sel.has(r.id) ? "border-primary" : "border-border"
              }`}
            >
              <button onClick={() => toggle(r.id)} className="block w-full">
                {r.poster ? (
                  <img src={r.poster} alt={`Miniatura de ${r.name}`} className="aspect-video w-full object-cover" />
                ) : (
                  <div className="grid aspect-video w-full place-items-center bg-surface-2">
                    <Film className="size-6 text-muted-foreground" />
                  </div>
                )}
              </button>
              <div className="space-y-1 p-3">
                <p className="truncate text-sm font-medium" title={r.name}>
                  {r.name}
                </p>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {modeLabel(r.mode)} · {formatBytes(r.bytes)} · {Math.round(r.seconds)}s · {fmtDate(r.createdAt)}
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => void download(r)}>
                    <Download className="mr-1 size-3.5" /> Baixar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await deleteResult(r.id);
                      await refresh();
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {cloudOnly.length > 0 && (
        <section className="mt-8">
          <h2 className="mono-label mb-2">Gerados em outro dispositivo</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Registrados na sua conta, mas o arquivo não está neste navegador — gere de novo para baixar.
          </p>
          <div className="divide-y divide-border rounded-xl border border-border">
            {cloudOnly.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Film className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{c.file_name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {modeLabel(c.mode)} · {formatBytes(c.bytes)} · {new Date(c.created_at).toLocaleDateString("pt-BR")}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
