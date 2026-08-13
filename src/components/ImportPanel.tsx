import { useRef } from "react";
import { Link as LinkIcon, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VIDEO_ACCEPT } from "@/lib/media";
import { FLOWS, type Mode } from "@/lib/flows";

interface Props {
  mode: Mode;
  count: number;
  onFiles: (files: FileList | null) => void;
  linkUrl: string;
  onLinkUrl: (v: string) => void;
  linkBusy: boolean;
  linkMsg: string | null;
  linkBlocked: boolean;
  onImportLink: () => void;
}

/** Zona de importação — cada ferramenta tem o seu próprio fluxo de entrada. */
export function ImportPanel({
  mode,
  count,
  onFiles,
  linkUrl,
  onLinkUrl,
  linkBusy,
  linkMsg,
  linkBlocked,
  onImportLink,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const flow = FLOWS[mode].import;

  return (
    <section
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onFiles(e.dataTransfer.files);
      }}
      className="panel border-dashed p-10 text-center"
    >
      <div className="mx-auto grid size-12 place-items-center rounded-xl bg-accent">
        <Upload className="size-5 text-primary" />
      </div>
      <p className="mt-4 text-lg font-semibold">
        <span className="step-num mr-2">{flow.step}</span>
        {flow.title}
      </p>
      <p className="mt-1 font-mono text-xs text-muted-foreground">{flow.hint}</p>
      {count > 0 && (
        <p className="mt-1 font-mono text-[11px] text-primary">
          {count} vídeo(s) na fila do {FLOWS[mode].brand}
        </p>
      )}

      <div className="mt-5 flex justify-center gap-2">
        <Button variant="outline" onClick={() => inputRef.current?.click()}>
          {flow.filesLabel}
        </Button>
        {flow.folder && (
          <Button variant="outline" onClick={() => folderRef.current?.click()}>
            Selecionar pasta
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={VIDEO_ACCEPT}
        multiple={flow.multiple}
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
      {flow.folder && (
        <input
          ref={folderRef}
          type="file"
          multiple
          hidden
          // @ts-expect-error atributo não tipado
          webkitdirectory=""
          onChange={(e) => onFiles(e.target.files)}
        />
      )}

      {flow.link ? (
        <div className="mx-auto mt-6 max-w-xl border-t border-border pt-5">
          <p className="mono-label">ou cole o link do vídeo</p>
          <div className="mt-2 flex gap-2">
            <input
              value={linkUrl}
              onChange={(e) => onLinkUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onImportLink()}
              placeholder={flow.linkPlaceholder}
              className="flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs outline-none focus:border-primary"
            />
            <Button onClick={onImportLink} disabled={linkBusy || !linkUrl.trim()}>
              <LinkIcon className="mr-1 size-4" />
              {linkBusy ? "baixando..." : "Importar"}
            </Button>
          </div>
          <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
            {flow.linkHint} usa o arquivo original público disponibilizado pela plataforma, quando existente.
          </p>
          {linkMsg && <p className="mt-2 font-mono text-[11px] text-muted-foreground">{linkMsg}</p>}
          {linkBlocked && (
            <div className="mx-auto mt-3 max-w-xl rounded-lg border border-border bg-muted/30 p-3 text-left">
              <p className="font-mono text-[11px] uppercase tracking-wider text-primary">como importar mesmo assim</p>
              <ol className="mt-2 space-y-1 font-mono text-[11px] leading-relaxed text-muted-foreground">
                <li>1. confirme que o post é público e que você tem permissão para usar o vídeo</li>
                <li>2. arraste o arquivo aqui em cima, ou use "{flow.filesLabel}"</li>
                <li>3. links diretos de arquivo (.mp4, .mov, .webm, .mkv, .m4v...) importam normalmente</li>
                <li>4. conteúdo privado, live, playlist ou protegido por DRM não pode ser importado</li>
              </ol>
            </div>
          )}
        </div>
      ) : (
        <p className="mx-auto mt-6 max-w-xl border-t border-border pt-5 font-mono text-[10px] leading-relaxed text-muted-foreground">
          a limpeza roda no arquivo original: importe o vídeo já baixado para preservar a qualidade máxima.
          {linkMsg && <span className="mt-2 block text-[11px]">{linkMsg}</span>}
        </p>
      )}
    </section>
  );
}
