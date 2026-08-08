import { downloadZip } from "client-zip";

export interface OutFile {
  name: string;
  blob: Blob;
}

type SavePicker = (opts?: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

export async function downloadAsZip(files: OutFile[], zipName = "vaiviral.zip") {
  if (!files.length) return;
  // um único arquivo não precisa de ZIP (evita cópia de centenas de MB na memória)
  if (files.length === 1) {
    triggerDownload(files[0]!.blob, files[0]!.name);
    return;
  }

  const entries = files.map((f) => ({ name: f.name, input: f.blob, lastModified: new Date() }));
  // client-zip só empacota (sem compressão): o gargalo é montar tudo na memória.
  // Quando o navegador permite, escrevemos direto no disco em streaming.
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: zipName,
        types: [{ description: "ZIP", accept: { "application/zip": [".zip"] } }],
      });
      const writable = await handle.createWritable();
      const stream = downloadZip(entries).body;
      if (stream) {
        await stream.pipeTo(writable);
        return;
      }
      await writable.write(await downloadZip(entries).blob());
      await writable.close();
      return;
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      /* sem permissão: cai no download normal */
    }
  }

  const blob = await downloadZip(entries).blob();
  triggerDownload(blob, zipName);
}

type DirPicker = () => Promise<FileSystemDirectoryHandle>;

export function fsAccessSupported() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** Salva direto numa pasta escolhida pelo usuário (File System Access API). */
export async function saveToFolder(files: OutFile[], onProgress?: (n: number) => void) {
  const picker = (window as unknown as { showDirectoryPicker: DirPicker }).showDirectoryPicker;
  const dir = await picker();
  let i = 0;
  for (const f of files) {
    const handle = await dir.getFileHandle(f.name, { create: true });
    const w = await handle.createWritable();
    await w.write(f.blob);
    await w.close();
    onProgress?.(++i);
  }
  return i;
}
