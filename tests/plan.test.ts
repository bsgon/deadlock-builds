import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import type { Item } from "../src/data/types.ts";
import { BASE_ITEM_SLOTS, findHero, findItem } from "../src/engine/index.ts";
import { soulsAtMinute } from "../src/meta/stats.ts";
import { optimize, type OptimizeInput } from "../src/optimizer/optimize.ts";
import { routeValue, simulate, MAX_EARLY_SALES, MAX_SALES, LATE_SALE_SOULS, type PlanContext } from "../src/optimizer/plan/simulate.ts";
import { validateRoute } from "../src/optimizer/route.ts";
import { MIN_HOLD_MINUTES, MIN_SALE_GAIN, routeSales } from "../src/optimizer/sales.ts";

const data = loadSnapshot();
const item = (name: string) => findItem(data, name);

/** Contexto simples: a pontuação é 1 + o preço dos itens / 1.000. */
const context = (extra: Partial<PlanContext> = {}): PlanContext => {
  const scoreAt = (items: Item[]) => 1 + items.reduce((s, i) => s + i.cost, 0) / 1000;
  return {
    data,
    souls: 20_000,
    required: new Set(),
    gates: [0, 0, 0, 0, 0],
    slotSouls: Array.from({ length: 13 }, () => 0),
    cells: [
      { from: 0, to: 10_000, souls: 5000, alive: 1 },
      { from: 10_000, to: 20_000, souls: 15_000, alive: 0.5 },
    ],
    scoreAt,
    rawScoreAt: scoreAt,
    bonus: new Map(),
    minuteAt: (souls) => souls / 500,
    patient: () => true,
    spike: null,
    sellsHighTier: () => false,
    saleRules: true,
    ...extra,
  };
};
const buy = (name: string, sold?: string) => ({ item: item(name), sold: sold ? item(sold) : null });

describe("simulação da rota", () => {
  it("pula compra repetida e desconta o componente", () => {
    const r = simulate(context(), [buy("Extra Spirit"), buy("Extra Spirit"), buy("Improved Spirit")]);
    expect(r.steps.map((s) => s.item.name)).toEqual(["Extra Spirit", "Improved Spirit"]);
    expect(r.steps[1]!.pay).toBe(item("Improved Spirit").cost - item("Extra Spirit").cost);
    expect(r.steps[1]!.upgradeFrom?.name).toBe("Extra Spirit");
  });

  it("slot que ainda não abriu atrasa a compra; acima do limite ela não sai", () => {
    const slots = context({ slotSouls: [0, 0, 9000] });
    const r = simulate(slots, [buy("Grit"), buy("Extra Spirit"), buy("Rapid Rounds")]);
    expect(r.steps.map((s) => s.earned)).toEqual([800, 9000]);
  });

  it("só vende sem slot livre, e cota e posse valem", () => {
    const full = context({ slotSouls: [0, 0] });
    // Posse de 10 min = 5.000 souls neste contexto.
    expect(simulate(full, [buy("Grit"), buy("Improved Spirit", "Grit")]).steps).toHaveLength(1);
    const waited = context({ slotSouls: [0, 0], gates: [0, 0, 8000, 0, 0] });
    const r = simulate(waited, [buy("Grit"), buy("Improved Spirit", "Grit")]);
    expect(r.steps[1]!.sold?.name).toBe("Grit");
    expect(r.steps[1]!.pay).toBe(1600 - 400);
    const free = simulate(context(), [buy("Grit"), buy("Improved Spirit", "Grit")]);
    expect(free.steps[1]!.sold).toBeNull();
  });

  it("J pesa o tempo: a mesma compra mais cedo vale mais, e trecho improvável vale menos", () => {
    const ctx = context();
    const at = (earned: number) => routeValue(ctx, [{ earned, after: [item("Grit")] }]);
    expect(at(2000)).toBeGreaterThan(at(6000));
    expect(at(6000) - at(8000)).toBeGreaterThan(at(16_000) - at(18_000));
  });

  it("item fixado fora da rota e pico de vitality perdido custam caro", () => {
    const plain = simulate(context(), [buy("Grit")]);
    const missing = simulate(context({ required: new Set([item("Improved Spirit").className]) }), [buy("Grit")]);
    const spike = simulate(context({ spike: { souls: 4800, deadline: 12_000 } }), [buy("Grit")]);
    expect(missing.value).toBeLessThan(plain.value - 1);
    expect(spike.value).toBeLessThan(plain.value - 0.5);
    expect(missing.j).toBe(plain.j);
  });
});

describe("modo plan", () => {
  const input = (hero: string, extra: Partial<OptimizeInput> = {}): OptimizeInput => ({ hero, objective: "optimized", souls: 50_000, itemSlots: 12, mode: "plan", planBudget: 6000, ...extra });

  it.each(["Haze", "Lady Geist", "Apollo"])("%s: rota aceita pela loja, com as travas, os slots da partida e J maior", (hero) => {
    const r = optimize(data, input(hero));
    expect(validateRoute(data, r, 12)).toEqual([]);
    const sales = routeSales(data, r.order);
    for (const s of sales) {
      expect(s.held, s.sold.name).toBeGreaterThanOrEqual(MIN_HOLD_MINUTES);
      expect(s.chain).toBe(false);
      expect(s.gain).toBeGreaterThanOrEqual(MIN_SALE_GAIN);
      expect(s.keepsStep).toBe(true);
    }
    expect(sales.length).toBeLessThanOrEqual(MAX_SALES);
    expect(r.order.filter((s) => s.sold && s.earned < LATE_SALE_SOULS).length).toBeLessThanOrEqual(MAX_EARLY_SALES);
    // O 10º item só entra quando os jogadores do herói costumam ter o slot.
    const id = findHero(data, hero).id;
    const tenth = soulsAtMinute(data, id, data.sales!.heroes[String(id)]!.slots[0]!);
    let count = 0;
    for (const s of r.order) {
      count += s.upgradeFrom || s.sold ? 0 : 1;
      if (count > BASE_ITEM_SLOTS) expect(s.earned).toBeGreaterThanOrEqual(tenth);
    }
    expect(r.vitality?.ok).toBe(true);
  }, 120_000);

  it("J não fica abaixo do da progressiva que respeita os slots", () => {
    // Sem sales.json não há prazo de slot: as duas rotas jogam com as mesmas regras.
    const same = { ...data, sales: undefined };
    const plan = optimize(same, input("Haze"));
    const old = optimize(same, input("Haze", { mode: "progressive" }));
    expect(plan.routeValue!).toBeGreaterThanOrEqual(old.routeValue! - 1e-9);
  }, 120_000);

  it("a mesma entrada dá a mesma rota", () => {
    const names = () => optimize(data, input("Vindicta", { planBudget: 2000 })).order.map((s) => s.item.name);
    expect(names()).toEqual(names());
  }, 120_000);

  it("respeita itens fixados e proibidos", () => {
    const r = optimize(data, input("Haze", { required: ["Unstoppable"], banned: ["Spirit Resilience"], planBudget: 3000 }));
    expect(r.items.map((i) => i.name)).toContain("Unstoppable");
    expect(r.order.map((s) => s.item.name)).not.toContain("Spirit Resilience");
  }, 120_000);
});
