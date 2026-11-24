import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { equippedItems, findHero, findItem } from "../src/engine/index.ts";
import { VITALITY_SPIKE_SOULS } from "../src/engine/rules.ts";
import { vitalitySpikeOf } from "../src/meta/stats.ts";
import { optimize, type OptimizeInput } from "../src/optimizer/optimize.ts";
import { validateRoute } from "../src/optimizer/route.ts";
import { canSell, holdAfter, keepsInvestment, MIN_HOLD_MINUTES, MIN_SALE_GAIN, routeSales, type Holdings } from "../src/optimizer/sales.ts";

const data = loadSnapshot();
const item = (name: string) => findItem(data, name);

/** A build que o app mostra. */
const appInput = (hero: string): OptimizeInput => {
  const spike = vitalitySpikeOf(data, findHero(data, hero).id, VITALITY_SPIKE_SOULS);
  return { hero, objective: "optimized", souls: 50_000, itemSlots: 12, vitalitySpike: spike ? { souls: VITALITY_SPIKE_SOULS, deadline: spike.souls } : false };
};

describe("travas de venda", () => {
  it("só vende depois da posse mínima", () => {
    const grit = item("Grit");
    const held = holdAfter(data, new Map(), grit, 5, null, [grit]);
    expect(canSell(held, grit, 5 + MIN_HOLD_MINUTES - 0.25)).toBe(false);
    expect(canSell(held, grit, 5 + MIN_HOLD_MINUTES)).toBe(true);
  });

  it("um upgrade reinicia a posse e continua marcado se o componente entrou por troca", () => {
    const extra = item("Extra Spirit");
    const improved = item("Improved Spirit");
    let held: Holdings = holdAfter(data, new Map(), extra, 2, null, [extra]);
    held = holdAfter(data, held, improved, 20, null, equippedItems(data, [extra, improved]));
    expect([...held.keys()]).toEqual([improved.className]);
    expect(canSell(held, improved, 25)).toBe(false);
    expect(canSell(held, improved, 30)).toBe(true);

    let swapped: Holdings = holdAfter(data, new Map(), extra, 2, item("Grit"), [extra]);
    swapped = holdAfter(data, swapped, improved, 20, null, equippedItems(data, [extra, improved]));
    expect(canSell(swapped, improved, 90)).toBe(false);
  });

  it("a venda não desfaz os 4.800 de uma árvore, a não ser que a compra os reponha", () => {
    const tier = (slot: string, t: number) => data.items.filter((i) => i.slot === slot && i.tier === t);
    const [w3] = tier("weapon", 3);
    const [w2, other] = tier("weapon", 2);
    const [s4] = tier("spirit", 4);
    expect(keepsInvestment([w3!, w2!], [w3!, s4!])).toBe(false);
    expect(keepsInvestment([w3!, w2!], [w3!, other!])).toBe(true);
    expect(keepsInvestment([w3!], [s4!])).toBe(true); // ainda não tinha o degrau
  });

  // Antes das travas, estes heróis vendiam em cadeia, itens recém-comprados ou por ganho de ruído.
  it.each(["Lady Geist", "Graves", "Rat King", "Holliday", "Vindicta", "Paige", "Baba", "Apollo", "Celeste", "Infernus", "Silver", "Seven", "McGinnis"])("%s: toda venda da rota respeita as travas", (hero) => {
    const r = optimize(data, appInput(hero));
    for (const s of routeSales(data, r.order)) {
      const label = `${s.sold.name} -> ${s.bought.name}`;
      expect(s.held, label).toBeGreaterThanOrEqual(MIN_HOLD_MINUTES);
      expect(s.chain, label).toBe(false);
      expect(s.gain, label).toBeGreaterThanOrEqual(MIN_SALE_GAIN);
      expect(s.keepsStep, label).toBe(true);
    }
    expect(validateRoute(data, r, 12)).toEqual([]);
  }, 60_000);

  it("sem as travas (saleRules: false), vendas ruins de Silver voltam: o teste acima pega a regressão", () => {
    const sales = routeSales(data, optimize(data, { ...appInput("Silver"), saleRules: false }).order);
    expect(sales.some((s) => s.chain || s.held < MIN_HOLD_MINUTES || s.gain < MIN_SALE_GAIN)).toBe(true);
  }, 60_000);

  // Com 12 slots, como no app. (Com 6 slots e 5 itens T4 fixados, as travas podem deixar um de fora.)
  it.each(["Vindicta", "Paige", "Haze"])("%s: as travas não deixam itens fixados de fora", (hero) => {
    const required = data.items.filter((i) => i.tier === 4 && !i.isActive).slice(0, 5).map((i) => i.className);
    const kept = (saleRules: boolean) => {
      const r = optimize(data, { ...appInput(hero), required, saleRules });
      return required.filter((cls) => r.items.some((i) => i.className === cls)).length;
    };
    expect(kept(true)).toBeGreaterThanOrEqual(kept(false));
  }, 60_000);
});
