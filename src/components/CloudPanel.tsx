import { useEffect, useState } from "react";
import { LogIn, LogOut, CloudUpload, CloudDownload, X, History } from "lucide-react";
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
  type BatchRow,
  type CloudUser,
} from "@/lib/cloud";
import type { Template } from "@/lib/template";

interface Props {
  templates: Template[];
  onClose: () => void;
  onChangeList: (list: Template[]) => void;
}

export function CloudPanel({ templates, onClose, onChangeList }: Props) {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState<BatchRow[]>([]);

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
  }, [user]);

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
