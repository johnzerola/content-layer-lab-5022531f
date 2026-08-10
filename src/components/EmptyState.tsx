import type { LucideIcon } from "lucide-react";

export interface EmptyStep {
  icon: LucideIcon;
  title: string;
  text: string;
}

/**
 * Estado vazio que ensina o fluxo em 3 passos, no lugar de uma frase solta.
 */
export function EmptyState({
  title,
  subtitle,
  steps,
  action,
}: {
  title: string;
  subtitle: string;
  steps: EmptyStep[];
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-6 text-center">
      <h3 className="font-display text-base font-bold text-foreground">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{subtitle}</p>

      <ol className="mx-auto mt-5 grid max-w-3xl gap-3 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-xl border border-border bg-surface-2/60 p-4 text-left">
            <div className="flex items-center gap-2">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-primary/40 bg-primary/12 text-primary">
                <s.icon className="size-4" />
              </span>
              <span className="text-xs font-semibold text-muted-foreground">passo {i + 1}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-foreground">{s.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.text}</p>
          </li>
        ))}
      </ol>

      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
