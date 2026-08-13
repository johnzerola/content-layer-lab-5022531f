import { useEffect, useState, type ReactNode } from "react";
import { Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { currentUser, onAuth, signIn, signUp, type CloudUser } from "@/lib/cloud";
import { toast } from "sonner";

/**
 * Ferramentas que gravam no banco (CleanerIA) exigem sessão — sem ela o
 * servidor responde "Unauthorized: No authorization header provided".
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const off = onAuth((u) => {
      setUser(u);
      setReady(true);
    });
    currentUser()
      .then((u) => setUser(u))
      .finally(() => setReady(true));
    return off;
  }, []);

  const submit = async (mode: "in" | "up") => {
    if (!email || password.length < 6) {
      toast.error("Informe e-mail e senha com pelo menos 6 caracteres.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "in") {
        await signIn(email, password);
      } else {
        const active = await signUp(email, password);
        toast.success(active ? "Conta criada." : "Conta criada — confirme o e-mail para entrar.");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <div className="grid min-h-60 place-items-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }

  if (user) return <>{children}</>;

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-border/60 bg-surface/40 p-6">
      <div className="mb-4 flex items-center gap-2">
        <LogIn className="size-4 text-primary" />
        <h2 className="font-display text-lg font-bold">Entre para usar o CleanerIA</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Os jobs de limpeza ficam salvos na sua conta com histórico e link de download.
      </p>
      <div className="space-y-3">
        <Input
          type="email"
          autoComplete="email"
          placeholder="seu@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          type="password"
          autoComplete="current-password"
          placeholder="senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex gap-2">
          <Button className="flex-1" disabled={busy} onClick={() => submit("in")}>
            {busy && <Loader2 className="mr-1 size-4 animate-spin" />} Entrar
          </Button>
          <Button variant="outline" className="flex-1" disabled={busy} onClick={() => submit("up")}>
            Criar conta
          </Button>
        </div>
        <button
          onClick={() => {
            setEmail("teste@vaiviral.com");
            setPassword("123456");
            toast.info("Dados de teste preenchidos. Clique em 'Entrar'.");
          }}
          className="w-full text-center text-[10px] text-muted-foreground underline hover:text-primary transition-colors"
        >
          Usar login de teste
        </button>
      </div>
    </div>
  );
}
