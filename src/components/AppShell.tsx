import { useState, type ReactNode } from "react";
import { Layers, Scissors, Eraser, Library, Cloud, PanelLeftClose, PanelLeftOpen } from "lucide-react";

export type AppMode = "lote" | "clip" | "limpar";

const MODES: { id: AppMode; label: string; hint: string; icon: typeof Layers }[] = [
  { id: "lote", label: "Lote com template", hint: "branding em massa", icon: Layers },
  { id: "clip", label: "Só cortes", hint: "clipagem sem template", icon: Scissors },
  { id: "limpar", label: "Limpar vídeo", hint: "remover legenda e marca", icon: Eraser },
];

interface Props {
  mode: AppMode;
  onMode: (m: AppMode) => void;
  count: number;
  onLibrary: () => void;
  onCloud: () => void;
  children: ReactNode;
}

export function AppShell({ mode, onMode, count, onLibrary, onCloud, children }: Props) {
  const [open, setOpen] = useState(true);
  const current = MODES.find((m) => m.id === mode)!;

  return (
    <div className="flex min-h-dvh w-full bg-background">
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border/70 bg-surface/60 backdrop-blur transition-[width] duration-300 md:flex ${
          open ? "w-[16.5rem]" : "w-[4.5rem]"
        }`}
      >
        <div className="flex items-center gap-3 px-4 py-5">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-[image:var(--gradient-primary)] font-display text-sm font-bold text-primary-foreground shadow-[var(--shadow-glow)]">
            vv
          </div>
          {open && (
            <div className="min-w-0">
              <p className="truncate font-display text-base font-bold tracking-tight text-foreground">
                VaiViral
              </p>
              <p className="truncate font-mono text-[10px] text-muted-foreground">roda no navegador</p>
            </div>
          )}
        </div>

        <nav className="flex flex-col gap-1 px-3">
          {open && <p className="mono-label px-2 pb-2 pt-3">Modo</p>}
          {MODES.map((m) => {
            const active = m.id === mode;
            return (
              <button
                key={m.id}
                onClick={() => onMode(m.id)}
                title={m.label}
                aria-current={active ? "page" : undefined}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  active
                    ? "bg-accent text-accent-foreground ring-1 ring-primary/30"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <m.icon className={`size-[18px] shrink-0 ${active ? "text-primary" : ""}`} />
                {open && (
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{m.label}</span>
                    <span className="block truncate font-mono text-[10px] opacity-70">{m.hint}</span>
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="mt-6 flex flex-col gap-1 px-3">
          {open && <p className="mono-label px-2 pb-2">Biblioteca</p>}
          <button
            onClick={onLibrary}
            title="Biblioteca de templates"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            <Library className="size-[18px] shrink-0" />
            {open && "Templates"}
          </button>
          <button
            onClick={onCloud}
            title="Nuvem"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            <Cloud className="size-[18px] shrink-0" />
            {open && "Nuvem"}
          </button>
        </div>

        <div className="mt-auto p-3">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Recolher menu" : "Expandir menu"}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            {open ? <PanelLeftClose className="size-[18px]" /> : <PanelLeftOpen className="size-[18px]" />}
            {open && "Recolher"}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <h1 className="truncate font-display text-lg font-bold tracking-tight">{current.label}</h1>
              <p className="truncate font-mono text-[11px] text-muted-foreground">{current.hint}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex rounded-xl border border-border bg-surface-2 p-0.5 md:hidden">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onMode(m.id)}
                    aria-label={m.label}
                    className={`grid size-9 place-items-center rounded-lg transition ${
                      m.id === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                    }`}
                  >
                    <m.icon className="size-4" />
                  </button>
                ))}
              </div>
              <span className="rounded-full border border-primary/35 bg-accent px-3 py-1.5 font-mono text-[11px] text-accent-foreground">
                ● {count} vídeo{count === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</div>
      </div>
    </div>
  );
}
