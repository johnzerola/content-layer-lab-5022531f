import { describe, expect, it } from "vitest";
import { bestCoverage, detectFromFrames, falsePositives, type Box } from "../detect-core";
import { fixtures } from "./fixtures";

type Report = { name: string; coverage: number[]; fps: number; found: number };

function run(): Report[] {
  return fixtures().map((f) => {
    const got = detectFromFrames(f.set).map(
      (r) => ({ x: r.x!, y: r.y!, w: r.w!, h: r.h! }) as Box,
    );
    return {
      name: f.name,
      coverage: f.truths.map((t) => bestCoverage(t, got)),
      fps: falsePositives(f.truths, got),
      found: got.length,
    };
  });
}

const reports = run();
const byName = (n: string) => reports.find((r) => r.name.startsWith(n))!;

describe("detecção de overlays — suíte de fixtures", () => {
  it("cobre a legenda de rodapé intermitente", () => {
    const r = byName("legenda de rodapé");
    expect(r.coverage[0]!).toBeGreaterThan(0.7);
  });

  it("cobre a marca d'água pequena de canto", () => {
    const r = byName("marca d'água pequena");
    expect(r.coverage[0]!).toBeGreaterThan(0.6);
  });

  it("cobre o logo de canto", () => {
    const r = byName("logo circular");
    expect(r.coverage[0]!).toBeGreaterThan(0.6);
  });

  it("cobre legenda e marca d'água na mesma cena", () => {
    const r = byName("legenda + marca");
    expect(r.coverage[0]!).toBeGreaterThan(0.6);
    expect(r.coverage[1]!).toBeGreaterThan(0.5);
  });

  it("não inventa áreas em cena limpa", () => {
    expect(byName("cena limpa").found).toBeLessThanOrEqual(1);
  });

  it("mantém falsos positivos baixos no conjunto", () => {
    const total = reports.reduce((a, r) => a + r.fps, 0);
    expect(total).toBeLessThanOrEqual(4);
  });
});
