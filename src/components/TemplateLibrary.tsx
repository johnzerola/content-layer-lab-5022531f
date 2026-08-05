import { useEffect, useRef, useState } from "react";
import { Copy, Download, History, RotateCcw, Trash2, Upload, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  deleteTemplate,
  duplicateTemplate,
  exportTemplate,
  importTemplateFile,
  loadVersions,
  type Template,
  type TemplateVersion,
} from "@/lib/template";

interface Props {
  templates: Template[];
  activeId: string;
  onClose: () => void;
  onChangeList: (list: Template[]) => void;
  onUse: (t: Template) => void;
  /** Salva um template (nova versão) na biblioteca. */
  onCommit: (t: Template, note?: string) => void;
}

const fmt = (ts?: number) =>
  ts ? new Date(ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export function TemplateLibrary({ templates, activeId, onClose, onChangeList, onUse, onCommit }: Props) {
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setVersions(openHistory ? loadVersions(openHistory) : []);
  }, [openHistory, templates]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/85 p-4 backdrop-blur">
      <div className="panel my-6 w-full max-w-3xl p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="mono-label">Biblioteca</p>
            <h2 className="text-lg font-semibold">Meus templates ({templates.length})</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
              <Upload className="size-4" /> Importar
            </Button>
            <button onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            try {
              const t = await importTemplateFile(f);
              onCommit(t, "importado");
              setError(null);
            } catch {
              setError("Não consegui ler esse arquivo de template.");
            }
          }}
        />

        {error && <p className="mb-3 font-mono text-xs text-destructive">{error}</p>}

        {templates.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Nenhum template salvo ainda. Edite o template ativo e clique em salvar.
          </p>
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <div key={t.id} className="rounded-xl border border-border bg-surface-2 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    {renaming === t.id ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          className="w-full rounded-lg border border-input bg-background px-2 py-1 text-sm"
                        />
                        <button
                          className="rounded-md border border-border p-1.5 hover:border-primary"
                          onClick={() => {
                            onCommit({ ...t, name: draftName.trim() || t.name }, "renomeado");
                            setRenaming(null);
                          }}
                        >
                          <Check className="size-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        className="truncate text-left text-sm font-semibold"
                        onClick={() => {
                          setRenaming(t.id);
                          setDraftName(t.name);
                        }}
                      >
                        {t.name}
                        {t.id === activeId && <span className="ml-2 font-mono text-[10px] text-primary">● ativo</span>}
                      </button>
                    )}
                    <p className="font-mono text-[11px] text-muted-foreground">
                      v{t.version ?? 1} · {fmt(t.updatedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button size="sm" onClick={() => onUse(t)}>
                      Usar
                    </Button>
                    <button
                      title="Histórico de versões"
                      className="rounded-md border border-border p-2 hover:border-primary"
                      onClick={() => setOpenHistory(openHistory === t.id ? null : t.id)}
                    >
                      <History className="size-3.5" />
                    </button>
                    <button
                      title="Duplicar"
                      className="rounded-md border border-border p-2 hover:border-primary"
                      onClick={() => onCommit(duplicateTemplate(t), "duplicado")}
                    >
                      <Copy className="size-3.5" />
                    </button>
                    <button
                      title="Exportar JSON"
                      className="rounded-md border border-border p-2 hover:border-primary"
                      onClick={() => exportTemplate(t)}
                    >
                      <Download className="size-3.5" />
                    </button>
                    <button
                      title="Excluir"
                      className="rounded-md border border-border p-2 text-muted-foreground hover:text-destructive"
                      onClick={() => onChangeList(deleteTemplate(templates, t.id))}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>

                {openHistory === t.id && (
                  <div className="mt-3 space-y-1.5 border-t border-border pt-3">
                    <p className="mono-label">Versões</p>
                    {versions.length === 0 && (
                      <p className="font-mono text-[11px] text-muted-foreground">sem histórico ainda</p>
                    )}
                    {versions.map((v) => (
                      <div key={v.version} className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-mono text-muted-foreground">
                          v{v.version} · {fmt(v.savedAt)}
                          {v.note ? ` · ${v.note}` : ""}
                        </span>
                        <div className="flex gap-1.5">
                          <button
                            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono hover:border-primary"
                            onClick={() => onUse({ ...v.snapshot })}
                          >
                            Usar
                          </button>
                          <button
                            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-mono hover:border-primary"
                            onClick={() => onCommit({ ...v.snapshot }, `restaurado da v${v.version}`)}
                          >
                            <RotateCcw className="size-3" /> Restaurar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
