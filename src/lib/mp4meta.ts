/**
 * Limpeza de metadados do MP4: zera as datas de criação/modificação
 * (mvhd, tkhd, mdhd) e remove a caixa "udta" (onde ficam tags do encoder).
 * Se qualquer coisa sair do esperado, devolve o arquivo original intacto.
 */
export function cleanMp4Metadata(input: ArrayBuffer): ArrayBuffer {
  try {
    const view = new DataView(input);
    const bytes = new Uint8Array(input);
    const type = (off: number) =>
      String.fromCharCode(bytes[off + 4]!, bytes[off + 5]!, bytes[off + 6]!, bytes[off + 7]!);

    const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "udta"]);

    const walk = (start: number, end: number) => {
      let off = start;
      while (off + 8 <= end) {
        let size = view.getUint32(off);
        const t = type(off);
        let header = 8;
        if (size === 1) {
          // tamanho de 64 bits
          size = Number(view.getBigUint64(off + 8));
          header = 16;
        }
        if (size === 0) size = end - off;
        if (size < header || off + size > end) return;

        if (t === "mvhd" || t === "tkhd" || t === "mdhd") {
          const p = off + header; // version(1) + flags(3)
          const version = bytes[p]!;
          if (version === 1) {
            view.setBigUint64(p + 4, 0n);
            view.setBigUint64(p + 12, 0n);
          } else {
            view.setUint32(p + 4, 0);
            view.setUint32(p + 8, 0);
          }
        } else if (t === "udta" || t === "meta" || t === "free") {
          // transforma em caixa "free" vazia (não pode remover bytes sem remontar offsets)
          bytes.fill(0, off + header, off + size);
          bytes[off + 4] = 0x66; // f
          bytes[off + 5] = 0x72; // r
          bytes[off + 6] = 0x65; // e
          bytes[off + 7] = 0x65; // e
        } else if (CONTAINERS.has(t)) {
          walk(off + header, off + size);
        }
        off += size;
      }
    };

    walk(0, bytes.byteLength);
    return input;
  } catch {
    return input;
  }
}
