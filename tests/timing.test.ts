import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { findHero } from "../src/engine/index.ts";
import { VITALITY_SPIKE_SOULS } from "../src/engine/rules.ts";
import { minuteForSouls, vitalitySpikeOf } from "../src/meta/stats.ts";
import { heroPace, maxWaitMinutes, pacePhase } from "../src/meta/timing.ts";
import { optimize } from "../src/optimizer/optimize.ts";

const data = loadSnapshot();

describe("ritmo das compras", () => {
  it("fases e espera máxima", () => {
    expect([0, 4.9, 5, 14.9, 15, 60].map(pacePhase)).toEqual([0, 0, 1, 2, 3, 3]);
    expect(maxWaitMinutes(null, 3)).toBeNull();
    const pace = heroPace(data, findHero(data, "Paige").id)!;
    expect(maxWaitMinutes(pace, 3)).toBe(pace.wait[0]![1]);
  });

  it("herói com pouca amostra usa o ritmo geral; sem timing.json, nenhum", () => {
    const id = findHero(data, "Paige").id;
    const few = { ...data, timing: { ...data.timing!, heroes: { [id]: { ...data.timing!.heroes[String(id)]!, players: 10 } } } };
    expect(heroPace(few, id)).toBe(few.timing.overall);
    expect(heroPace({ ...data, timing: undefined }, id)).toBeNull();
  });

  it("a rota não espera mais que os jogadores nem compra um tier cedo demais", () => {
    for (const name of ["Paige", "Infernus", "Abrams"]) {
      const hero = findHero(data, name);
      const pace = heroPace(data, hero.id)!;
      const spike = vitalitySpikeOf(data, hero.id, VITALITY_SPIKE_SOULS);
      const { order } = optimize(data, { hero: name, objective: "optimized", souls: 50_000, itemSlots: 12, vitalitySpike: spike ? { souls: VITALITY_SPIKE_SOULS, deadline: spike.souls } : false });
      let from = 0;
      for (const step of order) {
        // 0,5 min de folga: os minutos da tela andam de 15 em 15 s.
        expect(step.minute - from, `${name}: ${step.item.name}`).toBeLessThanOrEqual(maxWaitMinutes(pace, from)! + 0.5);
        from = minuteForSouls(data, hero.id, step.earned);
      }
      for (const tier of [2, 3, 4]) {
        const first = order.find((s) => s.item.tier === tier);
        if (first) expect(first.minute, `${name}: T${tier}`).toBeGreaterThanOrEqual(pace.first[tier - 1]![0] - 0.5);
      }
    }
  }, 120_000);
});
