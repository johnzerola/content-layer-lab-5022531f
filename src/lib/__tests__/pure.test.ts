import { describe, expect, it } from "vitest";
import { defaultAntiDup, makeVariation, describeVariation } from "../variation";
import { formatTime } from "../clips";
import {
  applyRatio,
  createTemplate,
  duplicateTemplate,
  fitCanvasToSource,
  orientationOf,
} from "../template";

describe("variation", () => {
  it("é determinística para a mesma seed", () => {
    const cfg = defaultAntiDup();
    expect(makeVariation(cfg, "abc")).toEqual(makeVariation(cfg, "abc"));
  });

  it("muda com seeds diferentes", () => {
    const cfg = defaultAntiDup();
    expect(makeVariation(cfg, "abc")).not.toEqual(makeVariation(cfg, "xyz"));
  });

  it("no modo manual aplica exatamente os valores dos sliders", () => {
    const cfg = { ...defaultAntiDup(), auto: false, brightness: 0.1, zoom: 0.2, rotate: 1.5 };
    const v = makeVariation(cfg, "seed");
    expect(v.brightness).toBeCloseTo(1.1);
    expect(v.zoom).toBeCloseTo(1.2);
    expect(v.rotate).toBeCloseTo(1.5);
  });

  it("mantém as variações automáticas dentro da amplitude configurada", () => {
    const cfg = defaultAntiDup();
    for (let i = 0; i < 50; i++) {
      const v = makeVariation(cfg, `s${i}`);
      expect(Math.abs(v.brightness - 1)).toBeLessThanOrEqual(cfg.brightness + 1e-6);
      expect(v.zoom - 1).toBeLessThanOrEqual(cfg.zoom + 1e-6);
      expect(v.trimStart).toBeLessThanOrEqual(cfg.trim + 1e-6);
      expect(Math.abs(v.rotate)).toBeLessThanOrEqual(cfg.rotate + 1e-6);
    }
  });

  it("descreve a variação de forma legível", () => {
    const d = describeVariation(makeVariation(defaultAntiDup(), "seed"));
    expect(d).toContain("brilho");
    expect(d).toContain("corte");
  });
});

describe("clips", () => {
  it("formata tempo em m:ss", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(9.6)).toBe("0:09");
    expect(formatTime(125)).toBe("2:05");
  });
});

describe("template", () => {
  it("detecta orientação", () => {
    expect(orientationOf(1080, 1920)).toBe("vertical");
    expect(orientationOf(1920, 1080)).toBe("horizontal");
    expect(orientationOf(1000, 1000)).toBe("square");
  });

  it("ajusta o canvas à fonte mantendo dimensões pares e <= 1080", () => {
    const t = fitCanvasToSource(createTemplate(), 1920, 1080);
    expect(t.canvasW! % 2).toBe(0);
    expect(t.canvasH! % 2).toBe(0);
    expect(Math.max(t.canvasW!, t.canvasH!)).toBeLessThanOrEqual(1080);
    expect(t.canvasW! / t.canvasH!).toBeCloseTo(1920 / 1080, 1);
  });

  it("applyRatio mantém o vídeo dentro do quadro", () => {
    const t = applyRatio(createTemplate(), 1080, 1350);
    expect(t.video.x).toBeGreaterThanOrEqual(0);
    expect(t.video.y).toBeGreaterThanOrEqual(0);
    expect(t.video.x + t.video.w).toBeLessThanOrEqual((t.canvasW ?? 1080) + 1);
    expect(t.video.y + t.video.h).toBeLessThanOrEqual((t.canvasH ?? 1920) + 1);
  });

  it("duplicar gera um novo id", () => {
    const a = createTemplate("A");
    const b = duplicateTemplate(a);
    expect(b.id).not.toBe(a.id);
  });
});
