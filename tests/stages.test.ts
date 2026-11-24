import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { findHero, owns } from "../src/engine/index.ts";
import { usageRate } from "../src/meta/usage.ts";
import { optimize } from "../src/optimizer/optimize.ts";
import { flexOptions, FLEX_MARGIN, longMatchShare, MAX_FLEX, MAX_SITUATIONAL, routeStages, situationalPicks, temporaries } from "../web/stages.ts";

const data = loadSnapshot();

describe("fases da build na tela", () => {
  it.each(["Lady Geist", "Haze", "Paige"])("%s: fases, temporários, flex e situacionais saem da rota", (hero) => {
    const id = findHero(data, hero).id;
    const r = optimize(data, { hero, objective: "optimized", souls: 50_000, itemSlots: 12 });
    const s = routeStages(data, r.order);
    expect([...s.start, ...s.core, ...s.extension]).toEqual(r.order);
    expect(Math.max(...s.start.map((x) => x.minute))).toBeLessThan(15);
    expect(Math.min(...s.extension.map((x) => x.minute))).toBeGreaterThanOrEqual(30);
    // Todo item do core que não chega ao fim foi vendido ou melhorado.
    const sold = temporaries(r.order);
    for (const i of s.coreItems) {
      const kept = r.items.includes(i);
      const upgraded = r.order.some((x) => x.upgradeFrom === i) || owns(data, r.items, i);
      expect(kept || sold.has(i.className) || upgraded, i.name).toBe(true);
    }
    for (const [cls, t] of sold) {
      const step = r.order.find((x) => x.item.className === cls)!;
      expect(t.minute).toBeGreaterThan(step.minute);
      expect(t.net).toBe(step.item.cost / 2);
    }
    const flex = flexOptions(data, id, r);
    expect(flex.length).toBeLessThanOrEqual(MAX_FLEX);
    for (const f of flex) {
      expect(f.margin).toBeLessThan(FLEX_MARGIN);
      expect(r.order.some((x) => x.item === f.item)).toBe(false);
      expect(f.item.tier).toBe(f.insteadOf.tier);
      expect(usageRate(data, id, f.item)!).toBeGreaterThanOrEqual(0.05);
    }
    const situational = situationalPicks(data, id, r);
    expect(situational.length).toBeLessThanOrEqual(MAX_SITUATIONAL);
    for (const t of situational) {
      expect(t.condition).toBeTruthy();
      expect(r.items.some((i) => i.className === t.items[0])).toBe(false);
    }
  }, 60_000);

  it("parte das partidas longas vem das faixas medidas", () => {
    const share = longMatchShare(data, findHero(data, "Haze").id)!;
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.9);
    expect(longMatchShare({ ...data, stats: undefined }, 13)).toBeNull();
  });
});
