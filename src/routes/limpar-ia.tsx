import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Eraser, Sparkles, Upload, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CleanerIAStudio } from "@/components/CleanerIAStudio";
import { AuthGate } from "@/components/AuthGate";
import { listCleanerJobs } from "@/lib/cleaner.functions";
import { useServerFn } from "@tanstack/react-start";
import { STAGE_LABEL, type CleanerJob } from "@/lib/cleaner";
import { toast } from "sonner";
import { cloudAuthHeaders, currentUser } from "@/lib/cloud";

export const Route = createFileRoute("/limpar-ia")({
  head: () => ({
    meta: [
      { title: "CleanerIA — Remoção profissional de legendas, textos e marcas" },
      {
        name: "description",
        content:
          "Remova legendas, textos, logos e marcas d'água de vídeos com inpainting temporal em GPU. Reconstrução real do fundo, sem blur.",
      },
      { property: "og:title", content: "CleanerIA — Remoção profissional de legendas, textos e marcas" },
      {
        property: "og:description",
        content:
          "Remova legendas, textos, logos e marcas d'água de vídeos com inpainting temporal em GPU. Reconstrução real do fundo, sem blur.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LimparIAPage,
});

interface UploadItem {
  id: string;
  file: File;
  poster: string | null;
  w: number;
  h: number;
}

function LimparIAPage() {
  const [item, setItem] = useState<UploadItem | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [history, setHistory] = useState<CleanerJob[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listJobs = useServerFn(listCleanerJobs);

  useEffect(() => {
    let active = true;
    currentUser()
      .then(async (user) => (user ? listJobs({ headers: await cloudAuthHeaders() }) : []))
      .then((jobs) => {
        if (active) setHistory((jobs as CleanerJob[]).slice(0, 10));
      })
      .catch(() => null);
    return () => {
      active = false;
    };
  }, [listJobs]);

  const onFile = useCallback(async (files: FileList | null) => {
    const file = files?.item(0);
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error("Selecione um arquivo de vídeo.");
      return;
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = url;

    let w = 1920;
    let h = 1080;
    let poster: string | null = null;

    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("não foi possível ler o vídeo"));
        setTimeout(() => reject(new Error("timeout ao ler metadados")), 5000);
      });
      w = video.videoWidth || w;
      h = video.videoHeight || h;

      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 90;
      const ctx = canvas.getContext("2d");
      if (ctx && video.duration && isFinite(video.duration)) {
        video.currentTime = Math.min(video.duration * 0.2, 1);
        await new Promise<void>((resolve) => {
          video.onseeked = () => {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            resolve();
          };
          video.onerror = () => resolve();
          setTimeout(() => resolve(), 1000);
        });
        poster = canvas.toDataURL("image/jpeg", 0.6);
      }
    } catch (e) {
      toast.warning("Preview não disponível — arquivo será processado mesmo assim.");
    } finally {
      URL.revokeObjectURL(url);
    }

    setItem({ id: crypto.randomUUID(), file, poster, w, h });
    setResultUrl(null);
  }, []);

  const drop = (e: React.DragEvent) => {
    e.preventDefault();
    onFile(e.dataTransfer.files);
  };

  if (item) {
    return (
      <div className="min-h-dvh bg-background p-4 md:p-8">
        <div className="mx-auto max-w-7xl">
          <div className="mb-6 flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => setItem(null)}>
              <ArrowLeft className="mr-1 size-4" /> Voltar
            </Button>
            <h1 className="font-display text-xl font-bold">AI Video Cleaner</h1>
            {resultUrl && (
              <a
                href={resultUrl}
                download
                className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                Baixar resultado
              </a>
            )}
          </div>
          <AuthGate>
            <CleanerIAStudio item={item} onComplete={(url) => setResultUrl(url)} />
          </AuthGate>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background p-4 md:p-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <div className="space-y-2 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
            <Sparkles className="size-3.5" /> CleanerIA
          </div>
          <h1 className="font-display text-3xl font-bold md:text-5xl">Remoção profissional de elementos</h1>
          <p className="mx-auto max-w-2xl text-muted-foreground">
            Legendas, textos, logos e marcas d'água são removidos reconstruindo o fundo com contexto temporal.
            Sem blur, sem mosaico, sem crop.
          </p>
        </div>

        <div
          onClick={() => inputRef.current?.click()}
          onDrop={drop}
          onDragOver={(e) => e.preventDefault()}
          className="group cursor-pointer rounded-3xl border-2 border-dashed border-border/60 bg-surface/40 p-10 text-center transition hover:border-primary/50 hover:bg-surface/60"
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => onFile(e.target.files)}
          />
          <div className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-primary/10">
            <Upload className="size-7 text-primary" />
          </div>
          <p className="font-display text-lg font-semibold">Arraste um vídeo ou clique para upload</p>
          <p className="mt-1 text-sm text-muted-foreground">MP4, MOV, WebM, MKV — até 4 GB</p>
        </div>

        {history.length > 0 && (
          <section className="space-y-4">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold">
              <History className="size-4 text-primary" /> Histórico recente
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {history.map((job) => (
                <div
                  key={job.id}
                  className="rounded-xl border border-border/60 bg-surface/40 p-4 text-sm"
                >
                  <p className="truncate font-semibold">{job.filename}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(job.created_at).toLocaleString("pt-BR")} · {STAGE_LABEL[job.status]}
                  </p>
                  {job.result_url && (
                    <a
                      href={job.result_url}
                      download
                      className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-primary"
                    >
                      <Eraser className="size-3" /> Baixar limpo
                    </a>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <div className="text-center">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Voltar para o dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
