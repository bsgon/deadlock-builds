import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { evaluateBuild } from "../src/engine/index.ts";
import { defenseOf, effectiveHealth } from "../src/optimizer/defense.ts";
import { optimize } from "../src/optimizer/optimize.ts";

const data = loadSnapshot();
const build = (items: string[]) => evaluateBuild(data, { hero: "Haze", souls: 30000, items, uptime: 0.5 });
const ehp = (items: string[]) => effectiveHealth(build(items));

describe("defesa além de vida e resistência", () => {
  it("sem itens de defesa especial, é a média de vida efetiva contra bala e spirit", () => {
    const b = build([]);
    expect(effectiveHealth(b)).toBeCloseTo((b.stats.ehpBullet + b.stats.ehpSpirit) / 2);
    expect(defenseOf(b).sources).toEqual([]);
  });

  it("barreira, invulnerabilidade, imunidade à morte e proteção contra controle aumentam a vida efetiva", () => {
    const base = ehp([]);
    for (const item of ["Spirit Shielding", "Divine Barrier", "Ethereal Shift", "Cheat Death", "Unstoppable", "Debuff Reducer", "Dispel Magic", "Plated Armor", "Metal Skin"]) {
      expect(ehp([item]), item).toBeGreaterThan(base);
    }
  });

  it("cada efeito cai no tipo certo", () => {
    const kinds = (item: string) => defenseOf(build([item])).sources.map((s) => s.kind);
    expect(kinds("Spirit Shielding")).toContain("barrier");
    expect(kinds("Ethereal Shift")).toContain("time");
    expect(kinds("Cheat Death")).toContain("time");
    expect(kinds("Unstoppable")).toContain("cc");
    expect(kinds("Debuff Reducer")).toContain("cc");
    expect(kinds("Plated Armor")).toContain("deflect");
  });

  it("proteção contra controle não passa de 100%", () => {
    expect(defenseOf(build(["Unstoppable", "Debuff Reducer", "Dispel Magic", "Spellbreaker"])).cc).toBeLessThanOrEqual(1);
  });
});

describe("itens de vitality no fim de jogo", () => {
  it("com 45 mil souls e 12 slots, a build otimizada tem vitality de tier 3 ou 4", () => {
    let high = 0;
    for (const hero of ["Haze", "Abrams", "Infernus", "Bebop"]) {
      const r = optimize(data, { hero, objective: "optimized", souls: 45000, itemSlots: 12 });
      high += r.items.filter((i) => i.slot === "vitality" && i.tier >= 3).length;
    }
    expect(high).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it("vida acima do piso ainda vale pontos, com retorno menor que dano", () => {
    const r = optimize(data, { hero: "Haze", objective: "optimized", souls: 30000 });
    expect(r.metrics.ehp).toBeGreaterThanOrEqual(r.weights.ehpFloor! * r.baseline.ehp * 0.99);
  }, 60_000);
});
