import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { HERO_COMBOS, heroesFor } from "../src/knowledge/hero-combos.ts";

const data = loadSnapshot();
const t4s = data.items.filter((i) => i.tier === 4);

describe("heróis por T4", () => {
  it("todo T4 tem pelo menos três heróis com motivo, e só T4 da loja aparecem", () => {
    expect(t4s.filter((i) => (HERO_COMBOS[i.name]?.length ?? 0) < 3).map((i) => i.name)).toEqual([]);
    expect(Object.keys(HERO_COMBOS).filter((name) => !t4s.some((i) => i.name === name))).toEqual([]);
  });

  it("todo herói existe, sem repetição no mesmo item, e com texto nos dois idiomas", () => {
    for (const [item, rows] of Object.entries(HERO_COMBOS)) {
      expect(rows.filter(([hero, pt, en]) => !data.heroes.some((h) => h.name === hero) || !pt || !en).map(([hero]) => `${item}: ${hero}`)).toEqual([]);
      expect(new Set(rows.map(([hero]) => hero)).size, item).toBe(rows.length);
    }
  });

  it("os heróis analisados compram o item acima da média", () => {
    const below = t4s.flatMap((item) =>
      heroesFor(data, item, 99)
        .filter((u) => u.reason && (u.lift ?? 0) < 1)
        .map((u) => `${item.name}: ${u.hero.name} ${u.lift?.toFixed(2)}`),
    );
    expect(below).toEqual([]);
  });

  it("a lista não usa a regra antiga de atributo em comum", () => {
    const reasons = Object.values(HERO_COMBOS).flatMap((rows) => rows.map(([, pt]) => pt));
    expect(reasons.filter((r) => /escala com isso/.test(r))).toEqual([]);
    expect(heroesFor(data, data.items.find((i) => i.name === "Vortex Web")!)[0]!.hero.name).toBe("The Doorman");
  });
});
