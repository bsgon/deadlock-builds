import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { findHero, findItem } from "../src/engine/index.ts";
import { bestPickRate, CHEAP_MIN_PICK, unusedItems } from "../src/meta/useful.ts";
import { optimize, type OptimizeInput } from "../src/optimizer/optimize.ts";

const data = loadSnapshot();
const paige = findHero(data, "Paige");
const input: OptimizeInput = { hero: "Paige", objective: "optimized", souls: 50_000, itemSlots: 12 };

describe("poda de itens sem uso", () => {
  it("tira só tiers 1 e 2 com pouca compra, e mantém os que o herói usa", () => {
    const unused = unusedItems(data, paige);
    expect(unused.size).toBeGreaterThan(0);
    for (const cls of unused) {
      const item = findItem(data, cls);
      expect(item.tier, item.name).toBeLessThanOrEqual(2);
      expect(bestPickRate(data, paige.id, item)!, item.name).toBeLessThan(CHEAP_MIN_PICK);
    }
    expect(unused.has(findItem(data, "Battle Vest").className)).toBe(true);
    expect(unused.has(findItem(data, "High-Velocity Rounds").className)).toBe(false);
  });

  it("a rota não compra nada podado e ainda enche os slots, com o pico de vitality", () => {
    for (const hero of ["Paige", "Abrams"]) {
      const unused = unusedItems(data, findHero(data, hero));
      const r = optimize(data, { ...input, hero });
      expect(r.order.filter((s) => unused.has(s.item.className)).map((s) => s.item.name)).toEqual([]);
      expect(r.items).toHaveLength(12);
      expect(r.vitality?.ok ?? true).toBe(true);
    }
  }, 120_000);

  it("item fixado nunca é podado", () => {
    const r = optimize(data, { ...input, required: ["Battle Vest"], mode: "final" });
    expect(r.items.map((i) => i.name)).toContain("Battle Vest");
  }, 120_000);

  it("sem estatísticas do herói não poda nada", () => {
    expect(unusedItems({ ...data, stats: undefined, elite: undefined }, paige).size).toBe(0);
  });
});
