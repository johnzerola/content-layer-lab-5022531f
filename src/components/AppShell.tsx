import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  Layers,
  Scissors,
  Eraser,
  Library,
  Cloud,
  CalendarClock,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Sparkle,
  Wand2,
  Droplets,
  HardDrive,
  Radio,
  Settings2,
  BarChart3,
  Shield,
} from "lucide-react";


export type AppMode = "lote" | "clip" | "limpar" | "limpar-ia" | "external";

type ModeDef = {
  id: AppMode;
  /** nome curto no menu */
  label: string;
  hint: string;
  /** marca própria da ferramenta */
  brand: string;
  mark: string;
  tagline: string;
  headline: string;
  description: string;
  chips: string[];
  icon: typeof Layers;
  badge: typeof Sparkle;
};

const MODES: ModeDef[] = [
  {
    id: "lote",
    label: "Lote com template",
    hint: "branding em massa",
    brand: "ViralBatch",
    mark: "VB",
    tagline: "branding em massa",
    headline: "Um template, centenas de vídeos prontos",
    description:
      "Monte o layout uma vez — avatar, nome, headline, CTA e marca d'água — e aplique em todo o lote com variações antiduplicidade.",
    chips: ["editor de template", "variações 3–5x", "branding automático", "ZIP por plataforma"],
    icon: Layers,
    badge: Sparkle,
  },
  {
    id: "clip",
    label: "Só cortes",
    hint: "clipagem sem template",
    brand: "CorteIA",
    mark: "CI",
    tagline: "clipagem inteligente",
    headline: "Ache os melhores momentos sozinho",
    description:
      "A IA lê energia de fala e movimento, pontua cada trecho e devolve os cortes prontos — sem template, sem branding, só o vídeo limpo no formato vertical.",
    chips: ["score viral", "duração min/máx", "reordenar cortes", "export direto"],
    icon: Scissors,
    badge: Wand2,
  },
  {
    id: "limpar",
    label: "Limpar vídeo",
    hint: "remover texto e marca",
    brand: "LimpaVídeo",
    mark: "LV",
    tagline: "restauração de quadro",
    headline: "Apague textos e marcas d'água",
    description:
      "Detecção automática das áreas fixas + reconstrução por inpainting (Telea) para tirar texto e logo sem borrão, mantendo o enquadramento original.",
    chips: ["detecção automática", "inpainting HQ", "antes / depois", "sem zoom"],
    icon: Eraser,
    badge: Droplets,
  },
  {
    id: "limpar-ia",
    label: "AI Video Cleaner",
    hint: "remoção profissional com GPU",
    brand: "CleanerIA",
    mark: "CI",
    tagline: "inpainting profissional",
    headline: "Remoção Profissional com ProPainter",
    description:
      "Módulo de alta fidelidade para reconstrução temporal profunda. Ideal para vídeos complexos onde a restauração local não é suficiente.",
    chips: ["ProPainter engine", "processamento configurável", "temporal tracking", "4K support"],
    icon: Sparkle,
    badge: Wand2,
  },
  {
    id: "external",
    label: "VaiViral",
    hint: "dashboard",
    brand: "VaiViral",
    mark: "VV",
    tagline: "clipagem em tempo real",
    headline: "Cortes Automáticos de Lives",
    description: "Monitore transmissões do X, Kick e TikTok e gere cortes automáticos baseados em IA sem precisar de templates.",
    chips: ["monitoramento HLS", "score viral IA", "exportação rápida"],
    icon: Sparkle,
    badge: Sparkle,
  },
];

interface Props {
  mode: AppMode;
  onMode: (m: AppMode) => void;
  count: number;
  /** total de vídeos na fila de cada ferramenta (filas independentes) */
  counts?: Partial<Record<AppMode, number>>;
  onLibrary: () => void;
  onCloud: () => void;
  children: ReactNode;
}

export function AppShell({ mode, onMode, count, counts, onLibrary, onCloud, children }: Props) {
  const [open, setOpen] = useState(true);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    import("@/lib/cloud").then(({ currentUser, onAuth }) => {
      void currentUser().then(setUser);
      return onAuth(setUser);
    });
  }, []);

  const current = MODES.find((m) => m.id === mode)!;

  // mantém portais (modais, toasts) na mesma identidade de cor
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-lote", "theme-clip", "theme-limpar", "theme-limpar-ia");
    root.classList.add(`theme-${mode}`);
  }, [mode]);

  return (
    <div className={`theme-${mode} flex min-h-dvh w-full bg-background`}>
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border/70 bg-surface/60 backdrop-blur transition-[width] duration-300 md:flex ${
          open ? "w-[16.5rem]" : "w-[4.5rem]"
        }`}
      >
        <div className="flex items-center gap-3 px-4 py-5">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary font-display text-sm font-bold text-primary-foreground shadow-[var(--shadow-glow)]">
            {current.mark}
          </div>
          {open && (
            <div className="min-w-0">
              <p className="truncate font-display text-base font-bold tracking-tight text-foreground">
                {current.brand}
              </p>
              <p className="truncate font-mono text-[10px] text-muted-foreground">{current.tagline}</p>
            </div>
          )}
        </div>

        <nav className="flex flex-col gap-1 px-3">
          {open && <p className="mono-label px-2 pb-2 pt-3">Ferramentas</p>}
          {MODES.map((m) => {
            const active = m.id === mode;
            const isExternal = ["/live", "/biblioteca", "/agenda", "/integracoes", "/armazenamento", "/metricas", "/admin"].some(path =>
              typeof window !== "undefined" && window.location.pathname.startsWith(path)
            );

            // Se estiver em uma rota externa/fixa, desativa o destaque visual das ferramentas de lote
            const visuallyActive = active && !isExternal;

              <button
                key={m.id}
                onClick={() => onMode(m.id)}
                title={m.brand}
                aria-current={active ? "page" : undefined}
                className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  visuallyActive

                    ? "bg-accent text-accent-foreground ring-1 ring-primary/30"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                }`}
              >
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-lg border transition ${
                    visuallyActive

                      ? "border-primary/40 bg-primary/15 text-primary"
                      : "border-border bg-surface-2 text-muted-foreground group-hover:text-foreground"
                  }`}
                >
                  <m.icon className="size-[15px]" />
                </span>
                {open && (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.brand}</span>
                    <span className="block truncate font-mono text-[10px] opacity-70">{m.hint}</span>
                  </span>
                )}
                {open && (counts?.[m.id] ?? 0) > 0 && (
                  <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {counts?.[m.id]}
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
          <Link
            to="/live"
            title="Monitora Live"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            <Radio className="size-[18px] shrink-0" />
            {open && "Monitora Live"}
          </Link>
          <Link
            to="/biblioteca"
            title="Biblioteca de Resultados"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            <History className="size-[18px] shrink-0" />
            {open && "Resultados"}
          </Link>
          <Link
            to="/agenda"
            title="Agenda de postagens"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            <CalendarClock className="size-[18px] shrink-0" />
            {open && "Agenda"}
          </Link>
          <Link
            to="/integracoes"
            title="Configurações e integrações"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            <Settings2 className="size-[18px] shrink-0" />
            {open && "Integrações"}
          </Link>
          <Link
            to="/armazenamento"
            title="Armazenamento e versões"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            <HardDrive className="size-[18px] shrink-0" />
            {open && "Armazenamento"}
          </Link>
          <Link
            to={"/metricas" as any}
            title="Métricas de performance"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            <BarChart3 className="size-[18px] shrink-0" />
            {open && "Métricas"}
          </Link>
          <Link
            to="/admin"
            title="Painel Administrativo"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            <Shield className="size-[18px] shrink-0" />
            {open && "Admin"}
          </Link>
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
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-primary/35 bg-primary/12 text-primary md:hidden">
                <current.icon className="size-4" />
              </span>
              <div className="min-w-0">
                <h1 className="truncate font-display text-lg font-bold tracking-tight">{current.brand}</h1>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{current.hint}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex rounded-xl border border-border bg-surface-2 p-0.5 md:hidden">
                {MODES.filter(m => m.id !== "external").map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onMode(m.id)}
                    aria-label={m.brand}
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

        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
          {mode === "external" || (typeof window !== "undefined" && ["/live", "/biblioteca", "/agenda", "/integracoes", "/armazenamento", "/metricas"].includes(window.location.pathname)) ? null : (
            <section
              key={current.id}
              className="mb-6 overflow-hidden rounded-2xl border border-border/70 bg-[var(--gradient-surface)] p-5 shadow-[var(--shadow-panel)] sm:p-6"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="mono-label flex items-center gap-2 text-primary">
                    <current.badge className="size-3.5" />
                    ferramenta independente
                  </p>
                  <h2 className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">
                    {current.headline}
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    {current.description}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {current.chips.map((c) => (
                      <span
                        key={c}
                        className="rounded-full border border-border bg-surface-2 px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="grid size-16 shrink-0 place-items-center rounded-2xl border border-primary/30 bg-primary/12 text-primary shadow-[var(--shadow-glow)]">
                  <current.icon className="size-7" />
                </div>
              </div>
            </section>
          )}

          {children}
        </div>
      </div>
    </div>
  );
}
