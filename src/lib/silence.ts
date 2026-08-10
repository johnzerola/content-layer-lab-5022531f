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
