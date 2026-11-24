import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { evaluateBuild, findHero, findItem, healthShare, itemUptime, ultimateReady } from "../src/engine/index.ts";
import { exitOf, measureSales, MIN_SWAP_SAMPLE, swapEvidence, type SaleBuy, type SaleMatch, type SalesStats } from "../src/meta/sales.ts";
import { COMMON_PICK, RARE_PICK, rarity, usageCosts, usageRate } from "../src/meta/usage.ts";
import { defenseOf, effectiveHealth } from "../src/optimizer/defense.ts";
import { optimize, type OptimizeInput } from "../src/optimizer/optimize.ts";
import type { Theory } from "../src/knowledge/theories.ts";

const data = loadSnapshot();
const item = (name: string) => findItem(data, name);
const build = (hero: string, items: string[], uptime = 0.5) => evaluateBuild(data, { hero, souls: 30_000, items, uptime });

describe("auditoria dos itens", () => {
  it("condição de vida: abaixo de 50% é pouco da luta, acima de 65% é a maior parte", () => {
    expect(healthShare("below", 50)).toBeCloseTo(0.153, 2);
    expect(healthShare("above", 65)).toBeCloseTo(0.717, 2);
    expect(healthShare("above", 50) + healthShare("below", 50)).toBeCloseTo(1);
    expect(itemUptime(item("Frenzy"), 0.5, "FervorFireRate")).toBeCloseTo(0.153, 2);
    expect(itemUptime(item("Battle Vest"), 0.5, "BonusFireRate")).toBeGreaterThan(0.5);
    expect(itemUptime(item("Frenzy"), 0, "FervorFireRate")).toBe(0);
  });

  it("Diviner's Kevlar só dá barreira nas lutas em que a ultimate está pronta", () => {
    expect(ultimateReady(120)).toBe(0.5);
    expect(ultimateReady(0)).toBe(1);
    const b = build("Haze", ["Diviner's Kevlar"]);
    const cooldown = b.abilities.find((a) => a.slot === 4)!.properties.AbilityCooldown!.value;
    expect(defenseOf(b).barrier).toBeCloseTo(item("Diviner's Kevlar").properties.CombatBarrier!.value * ultimateReady(cooldown), 0);
  });

  it("Blood Tribute cobra a vida que sacrifica", () => {
    // Desligado (uptime 0) não drena: a vida efetiva fica menor com o efeito ativo.
    expect(effectiveHealth(build("Haze", ["Blood Tribute"], 1))).toBeLessThan(effectiveHealth(build("Haze", ["Blood Tribute"], 0)));
  });
});

describe("peso do uso real", () => {
  it("raridade vai de 0 (comum) a 1 (quase ninguém compra)", () => {
    expect(rarity(COMMON_PICK)).toBe(0);
    expect(rarity(RARE_PICK)).toBeCloseTo(1);
    expect(rarity(0)).toBeCloseTo(1);
    expect(rarity(0.03)).toBeGreaterThan(rarity(0.06));
  });

  it("desconta só itens pouco usados, e nada com peso 0 ou sem estatísticas", () => {
    const haze = findHero(data, "Haze");
    const costs = usageCosts(data, haze, 0.02);
    expect(usageCosts(data, haze, 0).size).toBe(0);
    expect(usageCosts({ ...data, stats: undefined }, haze, 0.02).size).toBe(0);
    for (const i of data.items) if (usageRate(data, haze.id, i)! >= COMMON_PICK) expect(costs.has(i.className), i.name).toBe(false);
    expect(costs.size).toBeGreaterThan(0);
  });

  const app = (hero: string, extra: Partial<OptimizeInput> = {}): OptimizeInput => ({ hero, objective: "optimized", souls: 50_000, itemSlots: 12, ...extra });
  const rareItems = (hero: string, usageWeight?: number) => {
    const id = findHero(data, hero).id;
    return optimize(data, app(hero, usageWeight === undefined ? {} : { usageWeight })).items.filter((i) => usageRate(data, id, i)! < 0.05).length;
  };

  it.each(["Lady Geist", "Vindicta", "Baba"])("%s: menos itens que quase ninguém compra", (hero) => {
    expect(rareItems(hero)).toBeLessThan(rareItems(hero, 0));
  }, 60_000);

  it("não é veto: item raro obrigatório entra, e a pontuação mostrada não tem desconto", () => {
    const r = optimize(data, app("Haze", { required: ["Blood Tribute"] }));
    expect(r.items.map((i) => i.name)).toContain("Blood Tribute");
    const measured = optimize(data, app("Haze", { required: r.items.map((i) => i.className), fixedItems: true, vitalitySpike: false }));
    // fixedItems mede com o piso padrão; as métricas da mesma build são iguais.
    expect(measured.metrics.weaponDps).toBeCloseTo(r.metrics.weaponDps, 3);
    expect(r.score).toBeGreaterThan(0);
  }, 60_000);
});

describe("vendas dos jogadores", () => {
  const id = (name: string) => item(name).id;
  const shop = new Map(data.items.map((i) => [i.id, i]));

  it("separa venda, upgrade e compra desfeita", () => {
    const extra: SaleBuy = [id("Extra Spirit"), 100, 600, 0, 1000];
    const improved: SaleBuy = [id("Improved Spirit"), 600, 0, 0, 3000];
    expect(exitOf(data, shop, extra, [extra, improved])).toBe("upgraded");
    expect(exitOf(data, shop, extra, [extra])).toBe("sold");
    expect(exitOf(data, shop, [id("Grit"), 100, 120, 0, 900], [])).toBe("undone");
    expect(exitOf(data, shop, [id("Grit"), 100, 400, 1, 900], [])).toBe("upgraded");
    expect(exitOf(data, shop, improved, [extra, improved])).toBe("kept");
  });

  it("conta vendas, perda e posse por herói", () => {
    const sold: SaleBuy = [id("Grit"), 60, 60 + 20 * 60, 0, 900];
    const players = Array.from({ length: 12 }, (_, i) => ({ hero: 1, team: i < 6 ? 0 : 1, buys: [sold] }));
    const match: SaleMatch = { id: 1, winner: 0, duration: 1800, badge: 110, players };
    const stats = measureSales(data, [match, { ...match, id: 2 }], []);
    const hero = stats.heroes["1"]!;
    expect(hero.players).toBe(24);
    expect(hero.perPlayer).toBe(1);
    expect(hero.lost).toBe(400);
    expect(hero.held[1]).toBe(20);
    expect(hero.items[item("Grit").className]!.sales).toBe(24);
  });

  it("uma teoria de troca só é julgada com amostra e fora da margem", () => {
    const theory = { heroId: 1, kind: "late-swap", items: ["a", "b"] } as unknown as Theory;
    const stats = (swaps: number, lift: number, margin: number) => ({ swaps: [{ heroId: 1, sold: "a", bought: "b", swaps, lift, margin, minute: 30, held: 20 }] }) as unknown as SalesStats;
    expect(swapEvidence(stats(MIN_SWAP_SAMPLE - 1, 40, 1), theory).verdict).toBe("unclear");
    expect(swapEvidence(stats(200, 5, 4), theory).verdict).toBe("unclear"); // dentro de 1,5x a margem
    expect(swapEvidence(stats(200, 8, 4), theory).verdict).toBe("supported");
    expect(swapEvidence(stats(200, -8, 4), theory).verdict).toBe("contradicted");
    expect(swapEvidence({ swaps: [] } as unknown as SalesStats, theory).matches).toBe(0);
  });
});
