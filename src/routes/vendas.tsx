import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  Scissors,
  Captions,
  Eraser,
  Layers,
  Gauge,
  ShieldCheck,
  Repeat,
  FileArchive,
  Minus,
  Plus,
} from "lucide-react";

export const Route = createFileRoute("/vendas")({
  component: SalesPage,
  head: () => ({
    meta: [
      { title: "VaiViral — Fábrica de cortes para canais dark" },
      {
        name: "description",
        content:
          "Produza centenas de Reels, TikToks e Shorts por dia: cortes automáticos, legendas karaokê, remoção de marca d'água e anti-duplicidade. Feito para páginas e canais dark.",
      },
      { property: "og:title", content: "VaiViral — Fábrica de cortes para canais dark" },
      {
        property: "og:description",
        content:
          "Templates reutilizáveis, edição em massa e exportação MP4 pronta para Reels, TikTok e Shorts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const NAV = [
  { label: "Como funciona", href: "#fluxo" },
  { label: "Recursos", href: "#recursos" },
  { label: "Planos", href: "#planos" },
  { label: "FAQ", href: "#faq" },
];

const METRICS = [
  { value: "400+", label: "vídeos por lote" },
  { value: "9x", label: "mais rápido que editar à mão" },
  { value: "Local", label: "render do lote roda no seu PC" },
  { value: "3–5", label: "variações únicas por vídeo" },
];

const FLOW = [
  {
    n: "01",
    t: "Monte o template",
    d: "Avatar, @, selo, headline, CTA e marca d'água posicionados uma única vez. Salvo e versionado.",
  },
  {
    n: "02",
    t: "Jogue o lote inteiro",
    d: "Arraste uma pasta com centenas de arquivos ou cole links. Enquadramento automático em 9:16.",
  },
  {
    n: "03",
    t: "Corte e legende",
    d: "A IA acha os trechos com maior potência e queima legendas karaokê no estilo CapCut.",
  },
  {
    n: "04",
    t: "Baixe tudo em ZIP",
    d: "MP4 H.264 com preset por plataforma. Cada saída sai com assinatura diferente.",
  },
];

const FEATURES = [
  {
    icon: Scissors,
    t: "Clipagem por score",
    d: "Detecta os picos do vídeo longo e devolve cortes prontos com nota de potencial, duração mínima e máxima no seu controle.",
  },
  {
    icon: Captions,
    t: "Legenda karaokê",
    d: "Transcrição automática, timeline palavra a palavra e presets de estilo: pop, typewriter, slide e highlight.",
  },
  {
    icon: Eraser,
    t: "Limpeza sem borrão",
    d: "Inpainting por Fast Marching remove legenda queimada e marca d'água reconstruindo a textura — não é blur.",
  },
  {
    icon: Repeat,
    t: "Anti-duplicidade real",
    d: "Espelho, velocidade, pitch, ruído, moldura e metadados variam por saída. Cada arquivo é único de fato.",
  },
  {
    icon: Layers,
    t: "Editor tipo Canva",
    d: "Camadas livres, z-index, opacidade, snap com guias, undo/redo. Tudo arrastável, nada travado.",
  },
  {
    icon: FileArchive,
    t: "Lote e ZIP",
    d: "Fila com progresso por arquivo e por etapa, retry automático e download único no fim do processo.",
  },
];

const PLANS = [
  {
    name: "Starter",
    price: "R$ 47",
    tag: "Testar a esteira",
    items: ["60 exportações/mês", "3 templates salvos", "Legendas automáticas", "Cortes por score"],
    cta: "Começar",
    featured: false,
  },
  {
    name: "Creator",
    price: "R$ 97",
    tag: "Mais escolhido",
    items: [
      "Exportações ilimitadas",
      "Templates ilimitados + versões",
      "Remoção de legenda e marca d'água",
      "Até 5 variações por vídeo",
      "Presets Reels / TikTok / Shorts",
    ],
    cta: "Assinar o Creator",
    featured: true,
  },
  {
    name: "Studio",
    price: "R$ 247",
    tag: "Para operação em rede",
    items: [
      "Tudo do Creator",
      "Biblioteca compartilhada na nuvem",
      "Histórico de lotes",
      "Suporte prioritário",
    ],
    cta: "Falar com o time",
    featured: false,
  },
];

const FAQ = [
  {
    q: "Preciso aparecer ou gravar alguma coisa?",
    a: "Não. O sistema foi desenhado justamente para páginas e canais dark: você trabalha em cima de acervo, cortes e material licenciado, aplicando sua identidade por cima.",
  },
  {
    q: "Os vídeos saem realmente diferentes entre si?",
    a: "Sim. Cada saída recebe uma combinação própria de espelhamento, velocidade, pitch, grão, brilho, moldura e metadados. Você vê a diferença no preview antes de processar.",
  },
  {
    q: "A remoção de legenda estraga a imagem?",
    a: "A remoção usa inpainting multi-escala com mistura de borda em vez de desfoque, então a área reconstruída acompanha a textura ao redor. Há comparação lado a lado antes de exportar.",
  },
  {
    q: "Onde o vídeo é renderizado?",
    a: "O lote comum é renderizado no navegador com WebCodecs. Recursos como CleanerIA, importação por link e Agenda podem enviar arquivos ou URLs para VPS, Supabase ou para a rede social escolhida, sempre quando você aciona esses fluxos.",
  },
  {
    q: "Serve para qual formato?",
    a: "Reels, TikTok e Shorts em 9:16, além de 1:1, 4:5 e 16:9 com enquadramento automático conforme a origem.",
  },
];

function SalesPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Grain />
      <Header />
      <main>
        <Hero />
        <Marquee />
        <Flow />
        <Features />
        <Compare />
        <Plans />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

function Grain() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
      <div
        className="absolute inset-0 opacity-[0.55]"
        style={{
          background:
            "radial-gradient(900px 520px at 78% -10%, color-mix(in oklab, var(--primary) 20%, transparent), transparent 70%), radial-gradient(700px 420px at 5% 8%, color-mix(in oklab, var(--primary) 9%, transparent), transparent 72%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.14]"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklab, var(--foreground) 10%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 10%, transparent) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(80% 60% at 50% 0%, black, transparent 85%)",
        }}
      />
    </div>
  );
}

function Header() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header
      className={`sticky top-0 z-50 transition-colors duration-300 ${
        solid ? "border-b border-border/70 bg-background/80 backdrop-blur-xl" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5">
        <Link to="/vendas" className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
            <span className="font-display text-sm font-bold">V</span>
          </span>
          <span className="font-display text-[15px] font-semibold tracking-tight">VaiViral</span>
        </Link>
        <nav className="ml-auto hidden items-center gap-7 md:flex">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {n.label}
            </a>
          ))}
        </nav>
        <Link
          to="/"
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-transform hover:-translate-y-px md:ml-0"
        >
          Abrir estúdio <ArrowRight className="size-4" />
        </Link>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-5 pt-16 pb-14 md:pt-24 md:pb-20">
      <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_.95fr]">
        <div>
          <span className="mono-label inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5">
            <span className="size-1.5 rounded-full bg-primary" />
            para páginas e canais dark
          </span>
          <h1 className="mt-6 font-display text-[2.6rem] leading-[1.03] font-semibold tracking-tight md:text-[4.1rem]">
            Uma esteira que transforma
            <span className="block bg-[image:var(--gradient-primary)] bg-clip-text text-transparent">
              acervo bruto em 300 cortes
            </span>
            prontos para postar.
          </h1>
          <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-muted-foreground md:text-base">
            Template uma vez, lote infinito depois. Corte automático por score, legenda karaokê queimada,
            remoção de marca d'água sem borrão e anti-duplicidade arquivo por arquivo — tudo renderizado
            na sua própria máquina.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              to="/"
              className="group inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition-transform hover:-translate-y-0.5"
            >
              Processar meu primeiro lote
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#planos"
              className="inline-flex h-12 items-center rounded-xl border border-border px-6 text-sm font-medium text-foreground/90 transition-colors hover:bg-surface"
            >
              Ver planos
            </a>
          </div>
          <p className="mono-label mt-5">sem instalar nada · roda no navegador · exporta mp4 h.264</p>
        </div>
        <HeroPanel />
      </div>

      <dl className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-4">
        {METRICS.map((m) => (
          <div key={m.label} className="bg-background px-5 py-6">
            <dt className="font-display text-2xl font-semibold text-primary md:text-3xl">{m.value}</dt>
            <dd className="mt-1 text-xs leading-snug text-muted-foreground">{m.label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function HeroPanel() {
  const [p, setP] = useState(0.32);
  useEffect(() => {
    const id = setInterval(() => setP((v) => (v >= 1 ? 0.08 : +(v + 0.02).toFixed(2))), 260);
    return () => clearInterval(id);
  }, []);
  const rows = [
    { n: "raw_0148.mp4", s: "legenda" },
    { n: "raw_0149.mp4", s: "render 2/3" },
    { n: "raw_0150.mp4", s: "na fila" },
  ];
  return (
    <div className="panel relative overflow-hidden p-4 md:p-5">
      <div className="flex items-center gap-2 pb-4">
        <span className="size-2.5 rounded-full bg-destructive/70" />
        <span className="size-2.5 rounded-full bg-warn/70" />
        <span className="size-2.5 rounded-full bg-primary/70" />
        <span className="mono-label ml-2">lote · 128 arquivos</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-[7.5rem_1fr]">
        <div className="relative aspect-[9/16] overflow-hidden rounded-xl border border-border bg-surface-2">
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(200deg, color-mix(in oklab, var(--primary) 22%, transparent), transparent 55%), repeating-linear-gradient(115deg, color-mix(in oklab, var(--foreground) 4%, transparent) 0 6px, transparent 6px 14px)",
            }}
          />
          <div className="absolute inset-x-2 top-2 flex items-center gap-1.5">
            <span className="size-5 rounded-full bg-primary/80" />
            <span className="h-1.5 w-10 rounded-full bg-foreground/30" />
          </div>
          <div className="absolute inset-x-2 bottom-3 space-y-1">
            <span className="block h-2.5 w-full rounded bg-foreground/70" />
            <span className="block h-2.5 w-3/4 rounded bg-primary" />
          </div>
        </div>
        <div className="space-y-2.5">
          {rows.map((r, i) => (
            <div
              key={r.n}
              className="rounded-xl border border-border/80 bg-surface px-3 py-2.5"
              style={{ opacity: 1 - i * 0.22 }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] text-foreground/80">{r.n}</span>
                <span className="mono-label !text-[0.62rem]">{r.s}</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-[image:var(--gradient-primary)] transition-[width] duration-200"
                  style={{ width: `${Math.max(6, (p * 100) / (i + 1))}%` }}
                />
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5">
            <span className="text-xs font-medium text-foreground">saída pronta</span>
            <span className="font-mono text-[11px] text-primary">
              {Math.round(p * 128)}/128
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Marquee() {
  const items = [
    "Instagram Reels",
    "TikTok",
    "YouTube Shorts",
    "Kwai",
    "9:16",
    "4:5",
    "1:1",
    "MP4 H.264",
    "WebCodecs",
  ];
  return (
    <section className="relative z-10 border-y border-border/70 bg-surface/40 py-4">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-2 px-5">
        {items.map((i) => (
          <span key={i} className="mono-label">
            {i}
          </span>
        ))}
      </div>
    </section>
  );
}

function SectionHead({ tag, title, sub }: { tag: string; title: string; sub?: string }) {
  return (
    <div className="max-w-2xl">
      <span className="mono-label">{tag}</span>
      <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-[2.6rem] md:leading-[1.1]">
        {title}
      </h2>
      {sub ? <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function Flow() {
  return (
    <section id="fluxo" className="relative z-10 mx-auto max-w-6xl px-5 py-20 md:py-28">
      <SectionHead
        tag="fluxo"
        title="Quatro passos entre a pasta bruta e a fila de postagem."
        sub="Nenhuma etapa depende de você repetir trabalho. O que foi definido no template vale para o lote inteiro."
      />
      <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
        {FLOW.map((s) => (
          <li key={s.n} className="group bg-background p-6 transition-colors hover:bg-surface">
            <span className="step-num">{s.n}</span>
            <h3 className="mt-3 font-display text-lg font-semibold">{s.t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.d}</p>
            <span className="mt-5 block h-px w-8 bg-primary transition-all duration-300 group-hover:w-16" />
          </li>
        ))}
      </ol>
    </section>
  );
}

function Features() {
  return (
    <section id="recursos" className="relative z-10 mx-auto max-w-6xl px-5 py-20 md:py-28">
      <SectionHead
        tag="recursos"
        title="Cada gargalo da operação dark virou um botão."
      />
      <div className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <article
            key={f.t}
            className="panel group p-6 transition-transform duration-300 hover:-translate-y-1"
          >
            <span className="grid size-10 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
              <f.icon className="size-5" />
            </span>
            <h3 className="mt-5 font-display text-lg font-semibold">{f.t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.d}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function Compare() {
  const rows: Array<[string, string, string]> = [
    ["Editar 100 cortes", "~14 h no editor", "1 lote, um clique"],
    ["Legendar", "manual, corte a corte", "transcrição + karaokê automático"],
    ["Marca d'água alheia", "recorte ou blur feio", "inpainting reconstruindo textura"],
    ["Repostar sem duplicar", "gambiarra manual", "variação assinada por arquivo"],
    ["Padronizar identidade", "copiar e colar camadas", "template versionado"],
  ];
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-5 py-20 md:py-24">
      <div className="panel overflow-hidden">
        <div className="grid grid-cols-[1.1fr_1fr_1fr] gap-4 border-b border-border px-6 py-4">
          <span className="mono-label">tarefa</span>
          <span className="mono-label">do jeito manual</span>
          <span className="mono-label !text-[color:var(--primary)]">com vaiviral</span>
        </div>
        {rows.map(([a, b, c]) => (
          <div
            key={a}
            className="grid grid-cols-[1.1fr_1fr_1fr] items-center gap-4 border-b border-border/60 px-6 py-4 last:border-b-0"
          >
            <span className="text-sm font-medium">{a}</span>
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Minus className="size-3.5 shrink-0" />
              {b}
            </span>
            <span className="flex items-center gap-2 text-sm text-foreground">
              <Check className="size-3.5 shrink-0 text-primary" />
              {c}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Plans() {
  const [annual, setAnnual] = useState(false);
  return (
    <section id="planos" className="relative z-10 mx-auto max-w-6xl px-5 py-20 md:py-28">
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <SectionHead tag="planos" title="Preço fixo, volume livre." />
        <div className="inline-flex items-center gap-1 self-start rounded-xl border border-border p-1">
          {[
            { l: "Mensal", v: false },
            { l: "Anual −20%", v: true },
          ].map((o) => (
            <button
              key={o.l}
              onClick={() => setAnnual(o.v)}
              className={`rounded-lg px-4 py-2 text-xs font-medium transition-colors ${
                annual === o.v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-12 grid gap-4 lg:grid-cols-3">
        {PLANS.map((p) => {
          const base = Number(p.price.replace(/\D/g, ""));
          const value = annual ? Math.round(base * 0.8) : base;
          return (
            <article
              key={p.name}
              className={`panel relative flex flex-col p-6 ${
                p.featured ? "border-primary/40 shadow-[var(--shadow-glow)] lg:-mt-4 lg:pb-8" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold">{p.name}</h3>
                <span
                  className={`mono-label !text-[0.62rem] ${p.featured ? "!text-[color:var(--primary)]" : ""}`}
                >
                  {p.tag}
                </span>
              </div>
              <p className="mt-5 flex items-end gap-1.5">
                <span className="font-display text-4xl font-semibold tracking-tight">R$ {value}</span>
                <span className="pb-1.5 text-xs text-muted-foreground">/mês</span>
              </p>
              <ul className="mt-6 space-y-2.5">
                {p.items.map((i) => (
                  <li key={i} className="flex gap-2.5 text-sm text-muted-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    {i}
                  </li>
                ))}
              </ul>
              <Link
                to="/"
                className={`mt-8 inline-flex h-11 items-center justify-center rounded-xl text-sm font-semibold transition-transform hover:-translate-y-px ${
                  p.featured
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-foreground hover:bg-surface"
                }`}
              >
                {p.cta}
              </Link>
            </article>
          );
        })}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 text-primary" /> Transparência sobre quando VPS/Supabase são usados
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Gauge className="size-4 text-primary" /> Cancele quando quiser
        </span>
      </div>
    </section>
  );
}

function Faq() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="relative z-10 mx-auto max-w-3xl px-5 py-20 md:py-24">
      <SectionHead tag="faq" title="Perguntas antes de rodar o primeiro lote." />
      <div className="mt-10 divide-y divide-border border-y border-border">
        {FAQ.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q}>
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-6 py-5 text-left"
              >
                <span className="font-display text-[15px] font-medium md:text-base">{f.q}</span>
                {isOpen ? (
                  <Minus className="size-4 shrink-0 text-primary" />
                ) : (
                  <Plus className="size-4 shrink-0 text-muted-foreground" />
                )}
              </button>
              <div
                className="grid transition-[grid-template-rows] duration-300"
                style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
              >
                <div className="overflow-hidden">
                  <p className="pb-5 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FinalCta() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-5 pb-24">
      <div
        ref={ref}
        className="panel relative overflow-hidden px-6 py-14 text-center md:px-16 md:py-20"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(600px 260px at 50% 0%, color-mix(in oklab, var(--primary) 22%, transparent), transparent 70%)",
          }}
        />
        <div className="relative">
          <h2 className="mx-auto max-w-2xl font-display text-3xl font-semibold tracking-tight md:text-[2.8rem] md:leading-[1.08]">
            Enquanto você edita um corte, a esteira entrega o dia inteiro.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-[15px]">
            Abra o estúdio, monte seu template e jogue a primeira pasta. Em minutos você tem o ZIP
            pronto para a fila de postagem das suas páginas.
          </p>
          <Link
            to="/"
            className="mt-9 inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition-transform hover:-translate-y-0.5"
          >
            Abrir o estúdio agora <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="relative z-10 border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded bg-primary text-primary-foreground">
            <span className="font-display text-xs font-bold">V</span>
          </span>
          <span className="font-display text-sm font-semibold">VaiViral</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Use apenas conteúdo próprio ou licenciado. © {new Date().getFullYear()} VaiViral.
        </p>
      </div>
    </footer>
  );
}
