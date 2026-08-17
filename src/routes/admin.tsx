import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shield, UserPlus, ShieldAlert, Check, Loader2, RotateCcw } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { listUsers, setUserRole } from "@/lib/admin.functions";
import { currentUser } from "@/lib/cloud";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/admin")({
  beforeLoad: async () => {
    const user = await currentUser();
    if (!user) throw redirect({ to: "/" });
  },
  errorComponent: ({ error }) => {
    if (error.message.includes("Unauthorized")) {
      return (
        <div className="flex min-h-dvh flex-col items-center justify-center p-4">
          <div className="max-w-md text-center space-y-4">
            <ShieldAlert className="size-12 text-destructive mx-auto" />
            <h1 className="text-2xl font-bold text-foreground">Acesso Restrito</h1>
            <p className="text-muted-foreground">Você precisa de privilégios de administrador para acessar esta página.</p>
            <Button onClick={() => window.location.href = "/"}>Voltar para o Início</Button>
          </div>
        </div>
      );
    }
    return <div className="p-8 text-foreground">Erro: {error.message}</div>;
  },
  component: AdminPage,
});

function AdminPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  
  const fetchUsers = useServerFn(listUsers);
  const updateRole = useServerFn(setUserRole);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await fetchUsers();
      console.log("Admin loaded users:", data);
      setUsers(data as any[]);
    } catch (e: any) {
      console.error("Admin load error:", e);
      toast.error(e.message || "Falha ao carregar usuários");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const onUpdateRole = async (targetUserId: string, role: 'admin' | 'user' | 'moderator') => {
    setBusyId(targetUserId);
    try {
      await updateRole({ data: { targetUserId, role } });
      toast.success("Permissão atualizada com sucesso");
      await refresh();
    } catch (e: any) {
      toast.error(e.message || "Falha ao atualizar permissão");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppShell mode="external" onMode={() => {}} count={0} onLibrary={() => {}} onCloud={() => {}}>
        <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
          <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-primary mb-1">
                <Shield className="size-5" />
                <p className="mono-label">Administração</p>
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight">Gestão de Usuários</h1>
              <p className="text-muted-foreground">Gerencie permissões e visualize usuários registrados.</p>
            </div>
            <Button variant="outline" onClick={refresh} disabled={loading} className="w-fit">
              {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <RotateCcw className="size-4 mr-2" />}
              Atualizar
            </Button>
          </header>

          <div className="rounded-2xl border border-border bg-surface/60 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-surface-2 text-muted-foreground uppercase font-mono text-[10px]">
                  <tr>
                    <th className="px-6 py-4">ID do Usuário</th>
                    <th className="px-6 py-4">Papel Atual</th>
                    <th className="px-6 py-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((u) => (
                    <tr key={u.user_id} className="hover:bg-white/5 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs text-foreground">{u.user_id}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                          u.role === 'admin' ? 'bg-primary/10 border-primary/30 text-primary' : 
                          u.role === 'moderator' ? 'bg-amber-500/10 border-amber-500/30 text-amber-500' :
                          'bg-surface-2 border-border text-muted-foreground'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <select 
                            className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-xs outline-none text-foreground cursor-pointer"
                            value={u.role}
                            disabled={busyId === u.user_id}
                            onChange={(e) => onUpdateRole(u.user_id, e.target.value as any)}
                          >
                            <option value="user">User</option>
                            <option value="moderator">Moderator</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && !loading && (
                    <tr>
                      <td colSpan={3} className="px-6 py-12 text-center text-muted-foreground">
                        Nenhum registro de papel encontrado.
                      </td>
                    </tr>
                  )}
                  {loading && users.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-6 py-12 text-center text-muted-foreground">
                        <Loader2 className="size-8 animate-spin mx-auto mb-2 opacity-20" />
                        Carregando usuários...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </AppShell>
    </div>
  );
}
