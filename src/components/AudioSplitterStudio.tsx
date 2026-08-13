import { useState } from "react";
import { Music, Mic2, Play, Download, Loader2, Sparkles, Split } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { splitAudio } from "@/lib/audio";
import { startJob, updateJob, finishJob, failJob } from "@/lib/jobs";

interface Props {
  file: File;
  onComplete?: (voice: Blob, music: Blob, voiceUrl: string, musicUrl: string) => void;
}

export function AudioSplitterStudio({ file, onComplete }: Props) {
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<{ voice: string; music: string } | null>(null);

  const handleSplit = async () => {
    const jobId = startJob({
      tool: "lote", // Usando lote como fallback ou estender JobTool
      name: `Separando áudio: ${file.name}`,
      stage: "Carregando motor FFmpeg",
    });

    try {
      setProcessing(true);
      updateJob(jobId, { status: "processando", progress: 0.2, stage: "Extraindo trilhas..." });
      
      const { voice, music } = await splitAudio(file);
      
      const voiceUrl = URL.createObjectURL(voice);
      const musicUrl = URL.createObjectURL(music);
      
      setResults({ voice: voiceUrl, music: musicUrl });
      finishJob(jobId, "Áudio separado");
      toast.success("Áudio separado com sucesso!");
      
      if (onComplete) onComplete(voice, music, voiceUrl, musicUrl);
    } catch (error) {
      console.error(error);
      setProcessing(false);
      failJob(jobId, "Erro ao processar áudio");
      toast.error("Falha ao separar áudio. Tente um arquivo menor.");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="panel p-6 space-y-6 bg-surface-2/40 border-primary/20">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Music className="size-5 text-primary" />
            Separador de Áudio IA
          </h3>
          <p className="text-xs text-muted-foreground">Separe voz da trilha sonora automaticamente</p>
        </div>
        {!results && (
          <Button 
            onClick={handleSplit} 
            disabled={processing}
            className="shadow-glow"
          >
            {processing ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Split className="size-4 mr-2" />
            )}
            {processing ? "Processando..." : "Separar Agora"}
          </Button>
        )}
      </div>

      {results ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="p-4 rounded-xl border border-border bg-background/50 space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-primary">
                <Mic2 className="size-3.5" /> Voz / Diálogo
              </span>
              <Button variant="ghost" size="icon" className="size-8" asChild>
                <a href={results.voice} download="voz.mp3">
                  <Download className="size-4" />
                </a>
              </Button>
            </div>
            <audio src={results.voice} controls className="w-full h-8" />
          </div>

          <div className="p-4 rounded-xl border border-border bg-background/50 space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-blue-400">
                <Music className="size-3.5" /> Trilha / Música
              </span>
              <Button variant="ghost" size="icon" className="size-8" asChild>
                <a href={results.music} download="musica.mp3">
                  <Download className="size-4" />
                </a>
              </Button>
            </div>
            <audio src={results.music} controls className="w-full h-8" />
          </div>
          
          <div className="sm:col-span-2 flex justify-center pt-2">
             <Button variant="outline" size="sm" onClick={() => setResults(null)}>
               Limpar e tentar outro
             </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-border rounded-xl bg-background/20">
          <Sparkles className="size-8 text-primary/40 mb-3" />
          <p className="text-sm text-muted-foreground text-center px-6">
            O sistema usará FFmpeg para isolar as frequências de voz e música diretamente no seu navegador.
          </p>
        </div>
      )}
    </div>
  );
}
