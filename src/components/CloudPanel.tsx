import { useEffect, useState } from "react";
import { LogIn, LogOut, CloudUpload, CloudDownload, X, History, FolderSync, Trash2, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lovable } from "@/integrations/lovable/index";
import {
  currentUser,
  listBatches,
  onAuth,
  pullTemplates,
  pushTemplates,
  signIn,
  signOut,
  signUp,
  deleteProject,
  listExports,
  listProjects,
  saveProject,
  type BatchRow,
  type CloudUser,
  type ExportRow,
  type ProjectRow,
  type ProjectSnapshot,
} from "@/lib/cloud";
import type { Template } from "@/lib/template";

interface Props {
  templates: Template[];
  onClose: () => void;
  onChangeList: (list: Template[]) => void;
  /** ferramenta atual (lote, clip, limpar) */
  mode: string;
  /** monta o snapshot do projeto atual para salvar na nuvem */
  buildSnapshot: () => ProjectSnapshot;
  /** restaura um projeto salvo (rebaixa os vídeos que vieram por link) */
  onRestore: (snap: ProjectSnapshot) => Promise<void> | void;
}

export function CloudPanel({ templates, onClose, onChangeList, mode, buildSnapshot, onRestore }: Props) {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [exportsList, setExportsList] = useState<ExportRow[]>([]);
  const [projName, setProjName] = useState("Projeto 1");

  useEffect(() => {
    void currentUser().then(setUser);
    return onAuth(setUser);
  }, []);

  useEffect(() => {
    if (!user) {
      setBatches([]);
      return;
    }
    void listBatches()
      .then(setBatches)
      .catch(() => setBatches([]));
    void listProjects()
      .then(setProjects)
      .catch(() => setProjects([]));
    void listExports(20)
      .then(setExportsList)
      .catch(() => setExportsList([]));
  }, [user]);

  const refreshProjects = async () => setProjects(await listProjects().catch(() => []));

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background/85 p-4 backdrop-blur">
      <div className="panel my-10 w-full max-w-md p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="mono-label">Conta</p>
            <h2 className="text-lg font-semibold">Biblioteca na nuvem</h2>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {!user ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Entre para guardar seus templates e o histórico de lotes na sua conta.
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="senha"
              className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void run(() => signIn(email, password))}>
                <LogIn className="size-4" /> Entrar
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const active = await signUp(email, password);
                    setMsg(active ? "Conta criada." : "Confirme o e-mail que enviamos para ativar a conta.");
                  })
                }
              >
                Criar conta
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const r = await lovable.auth.signInWithOAuth("google", {
                      redirect_uri: window.location.origin,
                    });
                    if (r.error) throw new Error("Não foi possível entrar com Google.");
                  })
                }
              >
                Entrar com Google
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
              <span className="truncate font-mono text-[11px] text-muted-foreground">{user.email}</span>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(signOut)}>
                <LogOut className="size-4" /> Sair
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const n = await pushTemplates(templates);
                    setMsg(`${n} template(s) enviados para a nuvem.`);
                  })
                }
              >
                <CloudUpload className="size-4" /> Enviar templates
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const list = await pullTemplates(templates);
                    onChangeList(list);
                    setMsg(`Biblioteca atualizada (${list.length}).`);
                  })
                }
              >
                <CloudDownload className="size-4" /> Baixar templates
              </Button>
            </div>


            <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
              <p className="mono-label flex items-center gap-1">
                <FolderSync className="size-3" /> Projetos ({mode})
              </p>
              <div className="flex gap-2">
                <input
                  value={projName}
                  onChange={(e) => setProjName(e.target.value)}
                  placeholder="nome do projeto"
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-primary"
                />
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await saveProject(mode, projName.trim() || "Projeto", buildSnapshot());
                      await refreshProjects();
                      setMsg("Projeto salvo na nuvem.");
                    })
                  }
                >
                  Salvar
                </Button>
              </div>
              {projects.length === 0 ? (
                <p className="font-mono text-[11px] text-muted-foreground">Nenhum projeto salvo ainda.</p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-auto">
                  {projects.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1">
                      <span className="min-w-0 truncate font-mono text-[10px] text-muted-foreground">
                        [{p.mode}] {p.name} · {p.data?.items?.length ?? 0} vídeo(s) ·{" "}
                        {new Date(p.updated_at).toLocaleDateString("pt-BR")}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await onRestore(p.data);
                              setMsg("Projeto restaurado.");
                            })
                          }
                        >
                          Abrir
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await deleteProject(p.id);
                              await refreshProjects();
                            })
                          }
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
              <p className="mono-label flex items-center gap-1">
                <FileDown className="size-3" /> Arquivos exportados
              </p>
              {exportsList.length === 0 ? (
                <p className="font-mono text-[11px] text-muted-foreground">Nenhuma exportação registrada.</p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-auto">
                  {exportsList.map((e) => (
                    <li key={e.id} className="truncate font-mono text-[10px] text-muted-foreground">
                      {new Date(e.created_at).toLocaleDateString("pt-BR")} · [{e.mode}] {e.file_name} ·{" "}
                      {(Number(e.bytes) / 1e6).toFixed(1)} MB
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
              <p className="mono-label flex items-center gap-1">
                <History className="size-3" /> Últimos lotes
              </p>
              {batches.length === 0 ? (
                <p className="font-mono text-[11px] text-muted-foreground">Nenhum lote registrado ainda.</p>
              ) : (
                <ul className="max-h-48 space-y-1 overflow-auto">
                  {batches.map((b) => (
                    <li key={b.id} className="font-mono text-[10px] text-muted-foreground">
                      {new Date(b.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} ·{" "}
                      {b.mode} · {b.videos} vídeo(s) · {b.ok} ok / {b.failed} erro · {b.seconds}s
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {msg && <p className="mt-3 text-xs text-primary">{msg}</p>}
        {err && <p className="mt-3 text-xs text-destructive">{err}</p>}
      </div>
    </div>
  );
}
