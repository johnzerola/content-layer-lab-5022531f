import { downloadZip } from "client-zip";

export interface OutFile {
  name: string;
  blob: Blob;
}

export async function downloadAsZip(files: OutFile[], zipName = "vaiviral.zip") {
  const blob = await downloadZip(
    files.map((f) => ({ name: f.name, input: f.blob, lastModified: new Date() })),
  ).blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
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
