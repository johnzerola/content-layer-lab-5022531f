import { Component, type ErrorInfo, type ReactNode } from "react";
import { toast } from "sonner";

type Props = { children: ReactNode; onClose: () => void };
type State = { error: Error | null; stack: string | null };

/** Captura falhas de render do Estúdio para mostrar o motivo exato na tela. */
export class StudioBoundary extends Component<Props, State> {
  override state: State = { error: null, stack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[studio] falha ao renderizar o editor", error, info.componentStack);
    this.setState({ stack: info.componentStack ?? null });
    toast.error("O editor não abriu", { description: error.message });
  }

  override render() {
    const { error, stack } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="fixed inset-0 z-[100] grid place-items-center bg-background/95 p-6">
        <div className="max-w-lg space-y-3 rounded-xl border border-destructive/40 bg-surface-2 p-5">
          <h2 className="text-lg font-semibold text-destructive">O editor não abriu</h2>
          <p className="text-sm text-muted-foreground">Motivo: {error.message}</p>
          {stack && (
            <pre className="max-h-48 overflow-auto rounded-md bg-background p-2 font-mono text-[11px] text-muted-foreground">
              {stack.trim()}
            </pre>
          )}
          <div className="flex gap-2">
            <button
              className="rounded-md border border-border px-3 py-1.5 text-sm"
              onClick={() => {
                void navigator.clipboard.writeText(`${error.message}\n${stack ?? ""}`);
                toast.success("Erro copiado");
              }}
            >
              Copiar erro
            </button>
            <button
              className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
              onClick={() => {
                this.setState({ error: null, stack: null });
                this.props.onClose();
              }}
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    );
  }
}
