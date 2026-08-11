import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, HardDrive, Trash2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  clearAllVersions,
  deleteVersions,
  loadAllVersions,
  loadTemplates,
  storageUsage,
  type Template,
  type TemplateVersion,
} from "@/lib/template";

export const Route = createFileRoute("/armazenamento")({
  head: () => ({
    meta: [
      { title: "Armazenamento e versões de templates — VaiViral" },
      {
        name: "description",
        content:
          "Do not make any visual modifications. The phrases I write are commands to understand what I want, not to be written down. Understand their content well, then execute what is required. veja para criar isto de realmente remover, sem cria um borrap, efeito blur, ou quaqluer outra coisa assim",
      },
      { property: "og:title", content: "Armazenamento e versões de templates — VaiViral" },
      {
        property: "og:description",
        content: "Gerencie o histórico de versões dos seus templates e libere espaço local.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StoragePage,
});

const kb = (b: number) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 / 1024).toFixed(2)} MB`);
const fmt = (ts?: number) =>
  ts ? new Date(ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const LIMIT = 5 * 1024 * 1024; // quota típica do localStorage

function StoragePage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [map, setMap] = useState<Record<string, TemplateVersion[]>>({});
  const [usage, setUsage] = useState({ templates: 0, versions: 0, total: 0, other: 0 });
  const [sel, setSel] = useState<Set<string>>(new Set());

  const refresh = () => {
    setTemplates(loadTemplates());
    setMap(loadAllVersions());
    setUsage(storageUsage());
  };

  useEffect(refresh, []);

  const groups = useMemo(() => {
    const named = new Map(templates.map((t) => [t.id, t.name]));
    return Object.entries(map).map(([id, versions]) => ({
      id,
      name: named.get(id) ?? versions[0]?.snapshot?.name ?? "Template removido",
      orphan: !named.has(id),
      versions,
      bytes: JSON.stringify(versions).length * 2,
    }));
  }, [templates, map]);

  const totalVersions = groups.reduce((a, g) => a + g.versions.length, 0);
  const key = (id: string, v: number) => `${id}:${v}`;

  const toggle = (id: string, v: number) =>
    setSel((prev) => {
      const next = new Set(prev);
      const k = key(id, v);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const toggleGroup = (id: string, versions: TemplateVersion[]) =>
    setSel((prev) => {
      const next = new Set(prev);
      const all = versions.every((v) => next.has(key(id, v.version)));
      versions.forEach((v) => (all ? next.delete(key(id, v.version)) : next.add(key(id, v.version))));
      return next;
    });

  const removeSelected = () => {
    if (!sel.size) return;
    const byTemplate = new Map<string, number[]>();
    for (const k of sel) {
      const idx = k.lastIndexOf(":");
      const id = k.slice(0, idx);
      const v = k.slice(idx + 1);
      byTemplate.set(id, [...(byTemplate.get(id) ?? []), Number(v)]);
    }
    for (const [id, versions] of byTemplate) deleteVersions(id, versions);
    toast.success(`${sel.size} versão(ões) apagada(s)`);
    setSel(new Set());
    refresh();
  };

  const pct = Math.min(100, Math.round((usage.total / LIMIT) * 100));

  return (
    <div className="min-h-dvh bg-background px-4 py-8 sm:px-8">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link
              to="/"
              className="mb-2 inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" /> voltar
            </Link>
            <h1 className="font-display text-2xl font-bold tracking-tight">Armazenamento de templates</h1>
            <p className="text-sm text-muted-foreground">
              Selecione e apague versões antigas para não estourar o limite do navegador.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refresh}>
              <RotateCcw className="size-4" /> Atualizar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                clearAllVersions();
                setSel(new Set());
                refresh();
                toast.success("Histórico de versões limpo");
              }}
              disabled={totalVersions === 0}
            >
              <Trash2 className="size-4" /> Limpar histórico
            </Button>
            <Button size="sm" onClick={removeSelected} disabled={sel.size === 0}>
              Apagar selecionadas ({sel.size})
            </Button>
          </div>
        </div>

        <section className="panel p-5">
          <div className="mb-3 flex items-center gap-2">
            <HardDrive className="size-4 text-primary" />
            <p className="mono-label">Uso local</p>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-3 grid gap-2 font-mono text-[11px] text-muted-foreground sm:grid-cols-4">
            <span>total: {kb(usage.total)} ({pct}%)</span>
            <span>templates: {kb(usage.templates)}</span>
            <span>versões: {kb(usage.versions)}</span>
            <span>outros: {kb(usage.other)}</span>
          </div>
        </section>

        {groups.length === 0 ? (
          <p className="panel p-8 text-center text-sm text-muted-foreground">
            Nenhuma versão salva ainda.
          </p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <section key={g.id} className="panel p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {g.name}
                      {g.orphan && (
                        <span className="ml-2 font-mono text-[10px] text-muted-foreground">órfão</span>
                      )}
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {g.versions.length} versões · {kb(g.bytes)}
                    </p>
                  </div>
                  <button
                    className="rounded-md border border-border px-2 py-1 font-mono text-[11px] hover:border-primary"
                    onClick={() => toggleGroup(g.id, g.versions)}
                  >
                    selecionar tudo
                  </button>
                </div>

                <ul className="space-y-1.5">
                  {g.versions.map((v) => (
                    <li
                      key={v.version}
                      className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        className="size-4 accent-[hsl(var(--primary))]"
                        checked={sel.has(key(g.id, v.version))}
                        onChange={() => toggle(g.id, v.version)}
                        aria-label={`Selecionar versão ${v.version}`}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                        v{v.version} · {fmt(v.savedAt)}
                        {v.note ? ` · ${v.note}` : ""}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {kb(JSON.stringify(v).length * 2)}
                      </span>
                      <button
                        title="Apagar versão"
                        className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          deleteVersions(g.id, [v.version]);
                          refresh();
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
