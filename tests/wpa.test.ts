import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import type { GameData } from "../src/data/types.ts";
import { findHero } from "../src/engine/index.ts";
import { optimize } from "../src/optimizer/optimize.ts";
import {
  addPurchase,
  blendPriors,
  features,
  fitLogistic,
  itemWpa,
  purchaseResiduals,
  SHRINK_PURCHASES,
  teamWorth,
  winProbability,
  worthAt,
  type CompactMatch,
  type CompactPlayer,
  type WpaCell,
  type WpaStats,
} from "../src/meta/wpa.ts";

const player = (team: number, t: number[], nw: number[], buys: [number, number][] = []): CompactPlayer => ({ hero: 1, team, t, nw, buys });

describe("patrimônio ao longo da partida", () => {
  const p = player(0, [100, 300], [1000, 3000]);
  it("interpola entre as compras, sobe desde zero antes da primeira e mantém depois da última", () => {
    expect(worthAt(p, 200)).toBe(2000);
    expect(worthAt(p, 50)).toBe(500);
    expect(worthAt(p, 900)).toBe(3000);
  });

  it("soma por time, do ponto de vista pedido", () => {
    const m: CompactMatch = { id: 1, winner: 0, duration: 1200, players: [p, player(1, [100, 300], [500, 1500])] };
    expect(teamWorth(m, 0, 300)).toEqual({ own: 3000, enemy: 1500 });
    expect(teamWorth(m, 1, 300)).toEqual({ own: 1500, enemy: 3000 });
  });
});

describe("modelo de vitória", () => {
  it("os atributos trocam de sinal com o ponto de vista: P(A) + P(B) = 1", () => {
    const coef = [1, 2, -0.5];
    const a = winProbability(coef, features(30_000, 25_000, 1200));
    const b = winProbability(coef, features(25_000, 30_000, 1200));
    expect(a + b).toBeCloseTo(1, 10);
    expect(a).toBeGreaterThan(0.5);
  });

  it("o ajuste recupera os coeficientes de dados sintéticos", () => {
    const truth = [1.5, -0.8];
    // mulberry32: determinístico e sem a correlação entre chamadas seguidas de um LCG simples.
    let seed = 7;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const xs: number[][] = [];
    const ys: number[] = [];
    for (let i = 0; i < 20_000; i++) {
      const x = [rand() * 4 - 2, rand() * 4 - 2];
      xs.push(x);
      ys.push(rand() < winProbability(truth, x) ? 1 : 0);
    }
    const fit = fitLogistic(xs, ys);
    expect(fit[0]).toBeCloseTo(1.5, 1);
    expect(fit[1]).toBeCloseTo(-0.8, 1);
  });
});

describe("resíduo das compras", () => {
  it("resultado − P(vitória) no momento da compra, com o lado de quem comprou", () => {
    const m: CompactMatch = {
      id: 1,
      winner: 1,
      duration: 1500,
      players: [player(0, [600], [10_000], [[600, 11]]), player(1, [600], [5_000], [[600, 22]])],
    };
    const coef = [2, 0, 0];
    const seen: Record<number, { r: number; p: number }> = {};
    purchaseResiduals(m, coef, (_hero, id, r, p) => (seen[id] = { r, p }));
    // O time 0 estava à frente e perdeu: resíduo negativo; o time 1 o espelho disso.
    expect(seen[11]!.p).toBeGreaterThan(0.5);
    expect(seen[11]!.r).toBeCloseTo(-seen[11]!.p, 10);
    expect(seen[22]!.r).toBeCloseTo(1 - seen[22]!.p, 10);
    expect(seen[11]!.p + seen[22]!.p).toBeCloseTo(1, 10);
  });

  it("a célula separa compras à frente e atrás", () => {
    const cells: Record<string, WpaCell> = {};
    addPurchase(cells, "x", 0.2, 0.7, 600);
    addPurchase(cells, "x", -0.1, 0.3, 1200);
    addPurchase(cells, "x", 0.05, 0.5, 900);
    [3, 0.15, 0.0525, 1, 0.2, 1, -0.1, 45].forEach((v, i) => expect(cells.x![i]).toBeCloseTo(v, 10));
  });
});

describe("WPA no app", () => {
  const base = loadSnapshot();
  const hero = findHero(base, "Haze");
  const tier2 = base.items.filter((i) => i.tier === 2);
  const [a, b] = tier2;
  const cell = (n: number, mean: number): WpaCell => [n, n * mean, n * (mean * mean + 0.2), 0, 0, 0, 0, n * 10];
  const stats: WpaStats = {
    fetchedAt: "",
    days: 14,
    matches: 1000,
    purchases: 0,
    coef: [1, 1, 1],
    brier: 0.2,
    logLoss: 0.6,
    heroes: {
      [hero.id]: { [a!.className]: cell(1000, 0.04), [b!.className]: cell(1000, 0) },
      999: { [a!.className]: cell(1000, 0), [b!.className]: cell(1000, 0) },
    },
  };
  const data: GameData = { ...base, wpa: stats };

  it("puxa o valor do herói para a média geral do item pelo peso da amostra", () => {
    const w = itemWpa(data, hero.id, a!)!;
    // Herói: 4 pp em 1000 compras; geral: 2 pp. (1000 × 4 + K × 2) / (1000 + K).
    expect(w.wpa).toBeCloseTo((1000 * 4 + SHRINK_PURCHASES * 2) / (1000 + SHRINK_PURCHASES), 6);
    expect(w.purchases).toBe(1000);
    expect(w.minute).toBe(10);
  });

  it("o relativo compara com os outros itens do mesmo tier do herói", () => {
    const wa = itemWpa(data, hero.id, a!)!;
    const wb = itemWpa(data, hero.id, b!)!;
    // Mesma amostra: a média do tier fica no meio, e os dois relativos se anulam.
    expect(wa.relative).toBeCloseTo(-wb.relative, 6);
    expect(wa.relative).toBeGreaterThan(0);
  });

  it("sem wpa.json, nada", () => {
    const { wpa: _, ...without } = data;
    expect(itemWpa(without as GameData, hero.id, a!)).toBeNull();
  });
});

describe("peso das partidas no otimizador", () => {
  const base = loadSnapshot();
  const prior = (source: "window" | "wpa", delta: number, margin: number) => ({ source, window: "10–20 min", matches: 1000, delta, margin, shrunk: delta });

  it("blend pesa pela precisão: o WPA preciso puxa a janela enviesada", () => {
    const b = blendPriors(prior("window", 4, 0.5), prior("wpa", 0, 1))!;
    expect(b.source).toBe("blend");
    // Variância da janela = 0,26² + 2² ≈ 4,07; do WPA = 0,51² ≈ 0,26: quase tudo vem do WPA.
    expect(b.delta).toBeGreaterThan(0);
    expect(b.delta).toBeLessThan(0.5);
    expect(b.margin).toBeLessThan(1);
  });

  it("blend sem uma das fontes usa a outra", () => {
    const w = prior("window", 3, 1);
    expect(blendPriors(w, null)).toBe(w);
    expect(blendPriors(null, null)).toBeNull();
  });

  it.runIf(base.wpa !== undefined)("com wpa.json, o padrão é o blend; sem ele, a janela", () => {
    const input = { hero: "Haze", objective: "weapon" as const, souls: 15_000 };
    const sources = new Set(optimize(base, input).order.flatMap((s) => (s.matchPrior ? [s.matchPrior.source] : [])));
    expect([...sources].every((s) => s === "blend" || s === "window" || s === "wpa")).toBe(true);
    expect(sources.has("blend")).toBe(true);
    const { wpa: _, ...without } = base;
    const old = new Set(optimize(without as GameData, input).order.flatMap((s) => (s.matchPrior ? [s.matchPrior.source] : [])));
    expect([...old]).toEqual(["window"]);
  });
});
