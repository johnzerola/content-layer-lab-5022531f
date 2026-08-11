/**
 * Detecção de silêncio para cortar em pausas naturais de fala.
 * Usado no Monitora Live: em vez de fechar o corte exatamente no segundo N,
 * o gravador espera (até um limite) uma pausa curta para não cortar palavra.
 */

export interface LevelMeter {
  /** volume atual (0..1) */
  level(): number;
  /** histórico recente de níveis, 1 amostra a cada ~50ms */
  history(): number[];
  stop(): void;
}

export function createLevelMeter(stream: MediaStream): LevelMeter | null {
  if (!stream.getAudioTracks().length) return null;
  const Ctx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new Ctx();
  const src = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const hist: number[] = [];

  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i]! * buf[i]!;
    const rms = Math.sqrt(s / buf.length);
    hist.push(rms);
    if (hist.length > 1200) hist.shift();
  }, 50);

  return {
    level: () => hist[hist.length - 1] ?? 0,
    history: () => hist,
    stop: () => {
      window.clearInterval(timer);
      void ac.close();
    },
  };
}

/** Limiar de silêncio adaptado ao ruído de fundo do trecho. */
export function silenceThreshold(levels: number[]): number {
  if (!levels.length) return 0.01;
  const sorted = [...levels].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.15)] ?? 0;
  const mid = sorted[Math.floor(sorted.length * 0.6)] ?? 0.02;
  return Math.max(0.006, Math.min(mid * 0.5, floor * 2.5 + 0.004));
}

/**
 * Melhor ponto de corte: a pausa mais próxima do fim da janela.
 * `levels` são amostras de 50ms; devolve o índice escolhido.
 */
export function pickCutPoint(levels: number[], minIndex = 0, holdSamples = 6): number {
  const th = silenceThreshold(levels);
  for (let i = levels.length - 1; i >= minIndex + holdSamples; i--) {
    let quiet = true;
    for (let j = i - holdSamples; j <= i; j++) {
      if ((levels[j] ?? 1) > th) {
        quiet = false;
        break;
      }
    }
    if (quiet) return i;
  }
  return levels.length - 1;
}

/**
 * Espera uma pausa de fala. Resolve assim que houver `holdMs` abaixo do
 * limiar, ou quando estourar `maxWaitMs` (corte forçado).
 */
export function waitForSilence(
  meter: LevelMeter | null,
  opts: { holdMs?: number; maxWaitMs?: number } = {},
): Promise<"silencio" | "limite"> {
  const hold = opts.holdMs ?? 320;
  const maxWait = opts.maxWaitMs ?? 8000;
  if (!meter) return Promise.resolve("limite");

  return new Promise((resolve) => {
    const started = performance.now();
    let quietSince = 0;
    const timer = window.setInterval(() => {
      const hist = meter.history();
      const th = silenceThreshold(hist.slice(-400));
      const now = performance.now();
      if (meter.level() <= th) {
        if (!quietSince) quietSince = now;
        if (now - quietSince >= hold) {
          window.clearInterval(timer);
          resolve("silencio");
          return;
        }
      } else {
        quietSince = 0;
      }
      if (now - started >= maxWait) {
        window.clearInterval(timer);
        resolve("limite");
      }
    }, 50);
  });
}

/* ------------------------------------------------------------------ *
 * Remoção automática de silêncio em arquivos (estúdio de edição)      *
 * ------------------------------------------------------------------ */

export interface SilenceOptions {
  /** sensibilidade 0..1 — quanto maior, mais agressivo (corta pausas menores) */
  sensitivity?: number;
  /** pausa mínima (s) para valer o corte */
  minSilence?: number;
  /** folga (s) mantida antes/depois da fala para não cortar a respiração */
  padding?: number;
  /** trecho de fala mínimo mantido (s) */
  minKeep?: number;
  /** janela de análise dentro do vídeo */
  window?: { start: number; end: number } | null;
}

/** Decodifica o áudio do arquivo e devolve os trechos COM fala. */
export async function detectSpeechSegments(
  file: Blob,
  opts: SilenceOptions = {},
): Promise<{ segments: { start: number; end: number }[]; removed: number; duration: number }> {
  const Ctx =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error("Este navegador não consegue analisar o áudio.");
  const ac = new Ctx();
  let buf: AudioBuffer;
  try {
    buf = await ac.decodeAudioData(await file.arrayBuffer());
  } finally {
    void ac.close();
  }
  if (!buf.length) throw new Error("Este vídeo não tem áudio para analisar.");

  const sensitivity = Math.min(1, Math.max(0, opts.sensitivity ?? 0.5));
  const minSilence = opts.minSilence ?? 0.35;
  const padding = opts.padding ?? 0.08;
  const minKeep = opts.minKeep ?? 0.25;
  const lo = Math.max(0, opts.window?.start ?? 0);
  const hi = Math.min(buf.duration, opts.window?.end ?? buf.duration);

  // RMS em janelas de 20ms (mono somando os canais)
  const step = Math.max(1, Math.round(buf.sampleRate * 0.02));
  const chans: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
  const levels: number[] = [];
  for (let i = 0; i < buf.length; i += step) {
    let sum = 0;
    let n = 0;
    for (let j = i; j < Math.min(buf.length, i + step); j++) {
      let v = 0;
      for (const ch of chans) v += ch[j] ?? 0;
      v /= chans.length;
      sum += v * v;
      n++;
    }
    levels.push(Math.sqrt(sum / Math.max(1, n)));
  }

  const base = silenceThreshold(levels);
  // sensibilidade alta => limiar maior => mais coisa vira silêncio
  const th = base * (0.6 + sensitivity * 1.6);
  const tOf = (i: number) => (i * step) / buf.sampleRate;

  const raw: { start: number; end: number }[] = [];
  let open: number | null = null;
  for (let i = 0; i < levels.length; i++) {
    const loud = (levels[i] ?? 0) > th;
    if (loud && open === null) open = i;
    if (!loud && open !== null) {
      // só fecha se a pausa for longa o suficiente
      let j = i;
      while (j < levels.length && (levels[j] ?? 0) <= th) j++;
      if (tOf(j) - tOf(i) >= minSilence || j >= levels.length) {
        raw.push({ start: tOf(open), end: tOf(i) });
        open = null;
        i = j - 1;
      } else {
        i = j - 1;
      }
    }
  }
  if (open !== null) raw.push({ start: tOf(open), end: buf.duration });

  const segments: { start: number; end: number }[] = [];
  for (const s of raw) {
    const start = Math.max(lo, s.start - padding);
    const end = Math.min(hi, s.end + padding);
    if (end - start < minKeep) continue;
    const last = segments[segments.length - 1];
    if (last && start - last.end < 0.06) last.end = Math.max(last.end, end);
    else segments.push({ start, end });
  }

  const kept = segments.reduce((a, s) => a + (s.end - s.start), 0);
  return { segments, removed: Math.max(0, hi - lo - kept), duration: buf.duration };
}
