import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { currentUser, onAuth, signOut, type CloudUser } from "@/lib/cloud";
import { deleteMyAccount } from "@/lib/account.functions";

export const Route = createFileRoute("/conta")({
  component: AccountPage,
  head: () => ({
    meta: [{ title: "Conta e LGPD - VaiViral" }],
  }),
});

function AccountPage() {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = onAuth((u) => {
      setUser(u);
      setReady(true);
    });
    currentUser()
      .then(setUser)
      .finally(() => setReady(true));
    return off;
  }, []);

  async function removeAccount() {
    if (!window.confirm("Excluir sua conta e dados vinculados? Esta ação não pode ser desfeita.")) return;
    setBusy(true);
    try {
      await deleteMyAccount();
      await signOut();
      toast.success("Conta excluída.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível excluir a conta.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Voltar
      </Link>
      <section className="mt-6 rounded-2xl border border-border bg-surface/60 p-6">
        <h1 className="font-display text-2xl font-bold">Conta e dados</h1>
        {!ready ? (
          <Loader2 className="mt-6 size-5 animate-spin text-muted-foreground" />
        ) : user ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">{user.email}</p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              A exclusão remove sua conta de autenticação. Dados vinculados por chave de usuário são removidos pelas
              regras de cascata do banco quando aplicável.
            </p>
            <Button variant="destructive" className="mt-5" disabled={busy} onClick={removeAccount}>
              {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Trash2 className="mr-2 size-4" />}
              Excluir conta
            </Button>
          </>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">Entre na aba Nuvem para gerenciar sua conta.</p>
        )}
      </section>
    </main>
  );
}
