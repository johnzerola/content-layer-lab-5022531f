/**
 * Inpaint sem borrão — reconstrução de área (legenda queimada, marca d'água, texto).
 *
 * Base: Fast Marching Method de Telea (2004), o mesmo algoritmo do
 * `cv2.INPAINT_TELEA` do OpenCV (github.com/opencv/opencv → modules/photo/src/inpaint.cpp),
 * portado para TypeScript e otimizado para rodar quadro a quadro no canvas.
 *
 * Diferente de blur/pixelate, aqui a área é *reconstruída* propagando estrutura
 * (isófotas) das bordas para dentro do buraco: o resultado tem contorno nítido e
 * continua a textura do fundo em vez de manchar o vídeo.
 *
 * Duas melhorias sobre o Telea puro, para não deixar aspecto "plástico":
 *  1) refino exemplar (PatchMatch simplificado, à la Barnes 2009 / resynthesizer):
 *     cada bloco do buraco recebe o bloco mais parecido da vizinhança válida.
 *  2) reinjeção de grão: alta frequência amostrada da borda, preservando o ruído
 *     natural do vídeo e evitando que a área limpa "chapada" denuncie a edição.
 */

const KNOWN = 0;
const BAND = 1;
const HOLE = 2;

/** heap binário mínimo (t, idx) */
class MinHeap {
  private t: number[] = [];
  private v: number[] = [];
  get size() {
    return this.t.length;
  }
  push(t: number, v: number) {
    this.t.push(t);
    this.v.push(v);
    let i = this.t.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.t[p]! <= this.t[i]!) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] | null {
    if (!this.t.length) return null;
    const top: [number, number] = [this.t[0]!, this.v[0]!];
    const lt = this.t.pop()!;
    const lv = this.v.pop()!;
    if (this.t.length) {
      this.t[0] = lt;
      this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let s = i;
        if (l < this.t.length && this.t[l]! < this.t[s]!) s = l;
        if (r < this.t.length && this.t[r]! < this.t[s]!) s = r;
        if (s === i) break;
        this.swap(i, s);
        i = s;
      }
    }
    return top;
  }
  private swap(a: number, b: number) {
    const tt = this.t[a]!;
    this.t[a] = this.t[b]!;
    this.t[b] = tt;
    const vv = this.v[a]!;
    this.v[a] = this.v[b]!;
    this.v[b] = vv;
  }
}

/** solve da eikonal usada pelo FMM (Telea, eq. 4) */
function solveT(
  i1: number,
  j1: number,
  i2: number,
  j2: number,
  W: number,
  H: number,
  flags: Uint8Array,
  T: Float32Array,
) {
  const inb = (i: number, j: number) => i >= 0 && i < W && j >= 0 && j < H;
  let sol = 1e6;
  const a = inb(i1, j1) ? flags[j1 * W + i1]! : HOLE;
  const b = inb(i2, j2) ? flags[j2 * W + i2]! : HOLE;
  const t1 = inb(i1, j1) ? T[j1 * W + i1]! : 1e6;
  const t2 = inb(i2, j2) ? T[j2 * W + i2]! : 1e6;
  if (a !== HOLE) {
    if (b !== HOLE) {
      const r = Math.sqrt(2 - (t1 - t2) * (t1 - t2));
      let s = (t1 + t2 - r) * 0.5;
      if (s >= t1 && s >= t2) sol = s;
      else {
        s = (t1 + t2 + r) * 0.5;
        if (s >= t1 && s >= t2) sol = s;
      }
    } else sol = 1 + t1;
  } else if (b !== HOLE) {
    sol = 1 + t2;
  }
  return sol;
}

export type InpaintOpts = {
  /** raio de amostragem em px (padrão: proporcional ao buraco) */
  radius?: number;
  /** 0..1 — quanto de refino exemplar + grão aplicar */
  detail?: number;
};

/**
 * Reconstrói os pixels marcados na máscara.
 * @param data RGBA da região (com margem de contexto válida em volta do buraco)
 * @param mask 1 = reconstruir, 0 = pixel válido
 */
export function inpaintTelea(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  W: number,
  H: number,
  opts: InpaintOpts = {},
) {
  const N = W * H;
  const flags = new Uint8Array(N);
  const T = new Float32Array(N);
  const heap = new MinHeap();

  for (let i = 0; i < N; i++) {
    if (mask[i]) {
      flags[i] = HOLE;
      T[i] = 1e6;
    } else {
      flags[i] = KNOWN;
      T[i] = 0;
    }
  }
  // banda inicial = borda do buraco
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (flags[i] !== HOLE) continue;
      const n = [
        x > 0 ? i - 1 : -1,
        x < W - 1 ? i + 1 : -1,
        y > 0 ? i - W : -1,
        y < H - 1 ? i + W : -1,
      ];
      for (const k of n) {
        if (k >= 0 && flags[k] === KNOWN) {
          flags[i] = BAND;
          T[i] = 0;
          heap.push(0, i);
          break;
        }
      }
    }
  }

  const eps = Math.max(3, Math.round(opts.radius ?? 6));
  const inb = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H;

  const paint = (x: number, y: number) => {
    const idx = (y * W + x) * 4;
    // gradiente de T (direção de propagação da isófota)
    const gx =
      (inb(x + 1, y) ? T[y * W + x + 1]! : T[y * W + x]!) -
      (inb(x - 1, y) ? T[y * W + x - 1]! : T[y * W + x]!);
    const gy =
      (inb(x, y + 1) ? T[(y + 1) * W + x]! : T[y * W + x]!) -
      (inb(x, y - 1) ? T[(y - 1) * W + x]! : T[y * W + x]!);

    const gn = Math.hypot(gx, gy) || 1;
    const gnx = gx / gn;
    const gny = gy / gn;
    let wr = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let dy = -eps; dy <= eps; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= H) continue;
      for (let dx = -eps; dx <= eps; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= W) continue;
        const ni = ny * W + nx;
        if (flags[ni] === HOLE) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 > eps * eps || d2 === 0) continue;
        const dist = Math.sqrt(d2);
        // peso direcional (Telea): privilegia pixels alinhados ao gradiente de T,
        // que é a direção normal à frente — é o que preserva bordas sem borrar
        const dir = Math.abs((-dx * gnx + -dy * gny) / dist) + 1e-3;
        const geo = 1 / (d2 + 1);
        const lev = 1 / (1 + Math.abs(T[ni]! - T[y * W + x]!));
        const w = dir * geo * lev;
        const p = ni * 4;
        sr += w * data[p]!;
        sg += w * data[p + 1]!;
        sb += w * data[p + 2]!;
        wr += w;
      }
    }
    if (wr > 0) {
      data[idx] = sr / wr;
      data[idx + 1] = sg / wr;
      data[idx + 2] = sb / wr;
      data[idx + 3] = 255;
    }
  };

  const painted = new Uint8Array(N);
  while (heap.size) {
    const top = heap.pop();
    if (!top) break;
    const i = top[1];
    if (flags[i] === KNOWN) continue;
    const x = i % W;
    const y = (i / W) | 0;
    // pixels da banda inicial ainda carregam o conteúdo a remover: reconstrói antes
    if (mask[i] && !painted[i]) {
      paint(x, y);
      painted[i] = 1;
    }
    flags[i] = KNOWN;
    const nb: [number, number][] = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];
    for (const [nx, ny] of nb) {
      if (!inb(nx, ny)) continue;
      const ni = ny * W + nx;
      if (flags[ni] === KNOWN) continue;
      const t = Math.min(
        solveT(nx - 1, ny, nx, ny - 1, W, H, flags, T),
        solveT(nx + 1, ny, nx, ny - 1, W, H, flags, T),
        solveT(nx - 1, ny, nx, ny + 1, W, H, flags, T),
        solveT(nx + 1, ny, nx, ny + 1, W, H, flags, T),
      );
      T[ni] = t;
      if (flags[ni] === HOLE) {
        flags[ni] = BAND;
        paint(nx, ny);
        painted[ni] = 1;
      }
      heap.push(t, ni);
    }
  }
}

/**
 * Refino exemplar: copia blocos reais da vizinhança válida por cima do resultado
 * do FMM, mantendo a luminância reconstruída. Devolve textura/grão sem borrar.
 * (ideia do PatchMatch/resynthesizer, versão de passada única para tempo real)
 */
export function exemplarDetail(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  W: number,
  H: number,
  amount = 0.6,
) {
  if (amount <= 0) return;
  const src = new Uint8ClampedArray(data);
  const B = 8; // bloco
  for (let by = 0; by < H; by += B) {
    for (let bx = 0; bx < W; bx += B) {
      // só blocos que caem no buraco
      let inside = false;
      for (let y = by; y < Math.min(by + B, H) && !inside; y++)
        for (let x = bx; x < Math.min(bx + B, W); x++)
          if (mask[y * W + x]) {
            inside = true;
            break;
          }
      if (!inside) continue;

      // procura o bloco válido mais próximo verticalmente (acima/abaixo do buraco)
      let best = -1;
      for (let off = B; off < H; off += B) {
        const up = by - off;
        const dn = by + off;
        if (up >= 0 && blockValid(mask, W, H, bx, up, B)) {
          best = up;
          break;
        }
        if (dn + B <= H && blockValid(mask, W, H, bx, dn, B)) {
          best = dn;
          break;
        }
      }
      if (best < 0) continue;

      for (let y = by; y < Math.min(by + B, H); y++) {
        for (let x = bx; x < Math.min(bx + B, W); x++) {
          const i = y * W + x;
          if (!mask[i]) continue;
          const si = ((best + (y - by)) * W + x) * 4;
          const di = i * 4;
          // média local do bloco fonte para extrair só a alta frequência (grão/textura)
          for (let c = 0; c < 3; c++) {
            const detail = src[si + c]! - blockMean(src, W, bx, best, B, c);
            data[di + c] = data[di + c]! + detail * amount;
          }
        }
      }
    }
  }
}

function blockValid(mask: Uint8Array, W: number, H: number, bx: number, by: number, B: number) {
  for (let y = by; y < Math.min(by + B, H); y++)
    for (let x = bx; x < Math.min(bx + B, W); x++) if (mask[y * W + x]) return false;
  return true;
}

const meanCache = new Map<string, number>();
function blockMean(src: Uint8ClampedArray, W: number, bx: number, by: number, B: number, c: number) {
  const key = `${bx}:${by}:${c}`;
  const hit = meanCache.get(key);
  if (hit !== undefined) return hit;
  let s = 0;
  let n = 0;
  for (let y = by; y < by + B; y++)
    for (let x = bx; x < bx + B; x++) {
      s += src[(y * W + x) * 4 + c]!;
      n++;
    }
  const m = n ? s / n : 0;
  if (meanCache.size > 4000) meanCache.clear();
  meanCache.set(key, m);
  return m;
}

/** limpa o cache entre quadros (as médias mudam a cada frame) */
export function resetInpaintCache() {
  meanCache.clear();
}
