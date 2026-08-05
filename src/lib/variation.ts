/** Anti-duplicidade: variações sutis aplicadas por vídeo. */

export interface AntiDupConfig {
  auto: boolean;
  mirror: boolean;
  speed: number;
  /** amplitude máxima das variações automáticas */
  brightness: number; // ex 0.04 => ±4%
  saturation: number;
  zoom: number; // ex 0.03 => até +3% de zoom
  trim: number; // segundos cortados no início/fim (até)
  noise: number; // 0..1 intensidade do ruído
  cleanMetadata: boolean;
}

export const defaultAntiDup = (): AntiDupConfig => ({
  auto: true,
  mirror: false,
  speed: 1,
  brightness: 0.05,
  saturation: 0.06,
  zoom: 0.04,
  trim: 0.25,
  noise: 0.03,
  cleanMetadata: true,
});

export interface Variation {
  mirror: boolean;
  speed: number;
  brightness: number; // multiplicador (1 = neutro)
  saturation: number;
  zoom: number; // 1 = neutro
  trimStart: number;
  trimEnd: number;
  noise: number;
}

function hash(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** PRNG determinístico: mesma seed => mesma variação (reprocessar dá o mesmo arquivo). */
function rng(seed: string) {
  let s = hash(seed) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export function makeVariation(cfg: AntiDupConfig, seed: string): Variation {
  const base: Variation = {
    mirror: cfg.mirror,
    speed: cfg.speed,
    brightness: 1,
    saturation: 1,
    zoom: 1,
    trimStart: 0,
    trimEnd: 0,
    noise: 0,
  };
  if (!cfg.auto) return base;

  const r = rng(seed);
  const spread = (amp: number) => (r() * 2 - 1) * amp;

  return {
    mirror: cfg.mirror,
    speed: Number((cfg.speed + spread(0.02)).toFixed(3)),
    brightness: 1 + spread(cfg.brightness),
    saturation: 1 + spread(cfg.saturation),
    zoom: 1 + r() * cfg.zoom,
    trimStart: Number((r() * cfg.trim).toFixed(2)),
    trimEnd: Number((r() * cfg.trim).toFixed(2)),
    noise: cfg.noise * (0.5 + r() * 0.5),
  };
}

export function describeVariation(v: Variation) {
  return [
    v.mirror ? "espelho" : null,
    `${v.speed.toFixed(3)}x`,
    `brilho ${(v.brightness * 100).toFixed(0)}%`,
    `sat ${(v.saturation * 100).toFixed(0)}%`,
    `zoom ${((v.zoom - 1) * 100).toFixed(1)}%`,
    `corte ${v.trimStart.toFixed(2)}s/${v.trimEnd.toFixed(2)}s`,
  ]
    .filter(Boolean)
    .join(" · ");
}
