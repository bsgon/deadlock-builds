import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { findItem } from "../src/engine/index.ts";
import { compareInWindow, MIN_WINDOW_MATCHES, priorFactor, tierPrior, windowIndex, windowStat, WINDOWS, type PurchaseWindows } from "../src/meta/windows.ts";
import { analyzePurchase } from "../src/combat/explain.ts";
import { optimize } from "../src/optimizer/optimize.ts";

const data = loadSnapshot();
const paige = data.heroes.find((h) => h.name === "Paige")!;
const item = (name: string) => findItem(data, name);

describe("winrate por janela de compra", () => {
  it("snapshot cobre os heróis, em janelas de 10 minutos", () => {
    expect(data.windows).toBeDefined();
    expect(Object.keys(data.windows!.heroes).length).toBe(data.heroes.length);
    expect(windowIndex(0)).toBe(0);
    expect(windowIndex(9.9)).toBe(0);
    expect(windowIndex(10)).toBe(1);
    expect(windowIndex(75)).toBe(WINDOWS.length - 1);
  });

  it("compara com as compras do herói no mesmo momento, com intervalo de 95%", () => {
    const s = windowStat(data, paige.id, item("Vortex Web"), 28)!;
    expect(s.window).toBe("20–30 min");
    expect(s.matches).toBeGreaterThanOrEqual(MIN_WINDOW_MATCHES);
    expect(s.margin).toBeGreaterThan(0);
    expect(s.delta).toBeCloseTo(s.winrate - s.baseline, 5);
    const cmp = compareInWindow(data, paige.id, item("Vortex Web"), item("Diviner's Kevlar"), 28);
    if (cmp) expect(cmp.significant).toBe(Math.abs(cmp.diff) > cmp.margin);
  });

  it("sem dados por janela, cai para a média do herói e diz que não controla o momento", () => {
    const bare = { ...data, windows: undefined };
    const ctx = { hero: "Paige", souls: 30000, abilityTiers: [1, 1, 1, 0], plan: "control" as const };
    const r = analyzePurchase(bare, ctx, [item("Slowing Hex").className], [item("Vortex Web").className], item("Vortex Web"));
    expect(r.observed!.window).toBeNull();
    expect(r.uncertainty.some((u) => u.includes("sem dados por janela"))).toBe(true);
    expect(r.confidenceBest).not.toBe("alta");
  });

  it("alternativa de outro tier não é comparada pelo winrate (viés de quem já está à frente)", () => {
    const ctx = { hero: "Paige", souls: 30000, abilityTiers: [1, 1, 1, 0], plan: "control" as const };
    const r = analyzePurchase(data, ctx, [item("Slowing Hex").className], [item("Vortex Web").className], item("Vortex Web"), {
      item: item("Superior Cooldown"),
      after: [item("Slowing Hex").className, item("Superior Cooldown").className],
    });
    expect(r.observed!.versusAlternative).toBeNull();
    expect(r.observed!.diverges).toBe(false);
    expect(r.uncertainty.some((u) => u.includes("outro tier"))).toBe(true);
  });

  it("quando as partidas contrariam o modelo com folga, a confiança na compra cai para baixa", () => {
    // Dados fictícios: na janela 20–30 min, a alternativa vence muito mais que o Vortex.
    const hero: Record<string, [number, number][]> = {};
    const cells = (wins: number) => WINDOWS.map(() => [wins, 100_000] as [number, number]);
    hero[item("Vortex Web").className] = cells(40_000);
    hero[item("Diviner's Kevlar").className] = cells(60_000);
    const fake: PurchaseWindows = { fetchedAt: "", days: 30, windows: WINDOWS, heroes: { [String(paige.id)]: hero } };
    const ctx = { hero: "Paige", souls: 30000, abilityTiers: [1, 1, 1, 0], plan: "control" as const, scoreMargin: 0.5 };
    const r = analyzePurchase({ ...data, windows: fake }, ctx, [item("Slowing Hex").className], [item("Vortex Web").className], item("Vortex Web"), {
      item: item("Diviner's Kevlar"),
      after: [item("Slowing Hex").className, item("Diviner's Kevlar").className],
    });
    expect(r.observed!.diverges).toBe(true);
    expect(r.confidenceBest).toBe("baixa");
    expect(r.uncertainty.some((u) => u.includes("divergem"))).toBe(true);
  });

  it("peso das partidas: compara só no mesmo tier e encolhe amostra pequena para zero", () => {
    const vortex = item("Vortex Web");
    const kevlar = item("Diviner's Kevlar");
    const hero: Record<string, [number, number][]> = {};
    // Mesmo tier, amostra grande: 60% contra 50%.
    hero[vortex.className] = WINDOWS.map(() => [60_000, 100_000]);
    hero[item("Echo Shard").className] = WINDOWS.map(() => [50_000, 100_000]);
    // Tier diferente, winrate altíssimo: não entra na referência do Vortex.
    hero[item("Extra Charge").className] = WINDOWS.map(() => [90_000, 100_000]);
    // Amostra pequena com o mesmo +10 pp.
    hero[kevlar.className] = WINDOWS.map(() => [36, 60]);
    const fake: PurchaseWindows = { fetchedAt: "", days: 30, windows: WINDOWS, heroes: { [String(paige.id)]: hero } };
    const d = { ...data, windows: fake };
    const big = tierPrior(d, paige.id, vortex, 25)!;
    expect(vortex.tier).toBe(item("Echo Shard").tier);
    expect(big.delta).toBeCloseTo(5, 1); // (60+50)/2 = 55 → +5 pp, o tier 2 de 90% fica de fora
    expect(big.shrunk).toBeGreaterThan(4.5);
    const small = tierPrior(d, paige.id, kevlar, 25)!;
    expect(small.shrunk).toBeLessThan(small.delta / 3);
    expect(priorFactor(big, 0)).toBe(1);
    expect(priorFactor(big, 1)).toBeGreaterThan(1.5);
    expect(priorFactor({ ...big, shrunk: -50 }, 1)).toBe(0.5);
  });

  it("com peso, a build escolhe itens que vencem mais no próprio tier e janela", () => {
    const fake: PurchaseWindows = { fetchedAt: "", days: 30, windows: WINDOWS, heroes: {} };
    for (const h of data.heroes) {
      const byItem: Record<string, [number, number][]> = {};
      for (const it of data.items) byItem[it.className] = WINDOWS.map(() => [Math.round(100_000 * (0.4 + ((it.id % 89) / 89) * 0.2)), 100_000] as [number, number]);
      fake.heroes[String(h.id)] = byItem;
    }
    const d = { ...data, windows: fake };
    const mean = (w: number) => {
      const deltas = ["Haze", "Abrams"].flatMap((hero) => optimize(d, { hero, objective: "dps", souls: 20000, matchWeight: w }).order.map((s) => tierPrior(d, data.heroes.find((h) => h.name === hero)!.id, s.item, s.minute)?.delta ?? 0));
      return deltas.reduce((a, b) => a + b, 0) / deltas.length;
    };
    expect(mean(2)).toBeGreaterThan(mean(0) + 1);
  }, 120_000);

  it("desempate: só troca compras quase empatadas e quando a diferença nas partidas passa do intervalo", () => {
    // Dados fictícios com amostra enorme e winrates bem separados: todo quase-empate vira desempate.
    const fake: PurchaseWindows = { fetchedAt: "", days: 30, windows: WINDOWS, heroes: {} };
    for (const h of data.heroes) {
      const byItem: Record<string, [number, number][]> = {};
      for (const it of data.items) byItem[it.className] = WINDOWS.map(() => [Math.round(1_000_000 * (0.3 + ((it.id % 97) / 97) * 0.4)), 1_000_000] as [number, number]);
      fake.heroes[String(h.id)] = byItem;
    }
    const steps = ["Haze", "Abrams", "Seven"].flatMap((hero) => optimize({ ...data, windows: fake }, { hero, objective: "dps", souls: 20000 }).order);
    const broken = steps.filter((s) => s.tieBreak);
    expect(broken.length).toBeGreaterThan(0);
    for (const s of broken) {
      expect(s.tieBreak!.diff).toBeGreaterThan(s.tieBreak!.margin);
      expect(s.tieBreak!.over.className).not.toBe(s.item.className);
      // Mesmo tier: o winrate de um item mais caro na mesma janela mede quem já está à frente.
      expect(s.tieBreak!.over.tier).toBe(s.item.tier);
    }
  }, 120_000);
});
