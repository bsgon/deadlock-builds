import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { findItem } from "../src/engine/index.ts";
import { VITALITY_SPIKE_SOULS } from "../src/engine/rules.ts";
import { buildGraph, linksBetween, partnersByTree } from "../src/interactions/synergy.ts";
import { popularAtSouls } from "../src/meta/compare.ts";
import { midGameSouls, minuteForSouls, soulsAtMinute } from "../src/meta/stats.ts";
import { score } from "../src/optimizer/metrics.ts";
import { optimize } from "../src/optimizer/optimize.ts";

const data = loadSnapshot();
const heroId = data.heroes.find((h) => h.name === "Infernus")!.id;

describe("pico de vitality", () => {
  it("a tabela de investimento tem o salto em 4.800 souls", () => {
    const steps = data.shared.investment.vitality;
    const at = steps.findIndex((s) => s.souls === VITALITY_SPIKE_SOULS);
    expect(at).toBeGreaterThan(0);
    // É o maior salto de bônus entre dois degraus seguidos.
    const jumps = steps.slice(1).map((s, i) => s.bonus - steps[i]!.bonus);
    expect(Math.max(...jumps)).toBe(jumps[at - 1]);
  });

  it("build depois do prazo chega a 4.800 em vitality dentro do prazo", () => {
    const deadline = midGameSouls(data, heroId);
    const result = optimize(data, { hero: "Infernus", objective: "spirit", souls: 20_000 });
    const v = result.vitality!;
    expect(v.enforced).toBe(true);
    expect(v.invested).toBeGreaterThanOrEqual(VITALITY_SPIKE_SOULS);
    expect(v.reachedAt).not.toBeNull();
    expect(v.reachedAt!).toBeLessThanOrEqual(deadline);
    expect(v.ok).toBe(true);
  });

  it("build antes do prazo não é forçada", () => {
    const result = optimize(data, { hero: "Infernus", objective: "spirit", souls: 5_000 });
    expect(result.vitality!.enforced).toBe(false);
    expect(result.vitality!.ok).toBe(true);
  });

  it("a regra pode ser desligada", () => {
    expect(optimize(data, { hero: "Infernus", objective: "dps", souls: 20_000, vitalitySpike: false }).vitality).toBeNull();
  });
});

describe("curva de souls", () => {
  it("cresce com o tempo e o minuto inverte a curva", () => {
    expect(soulsAtMinute(data, heroId, 20)).toBeGreaterThan(soulsAtMinute(data, heroId, 10));
    const souls = soulsAtMinute(data, heroId, 18);
    expect(Math.abs(minuteForSouls(data, heroId, souls) - 18)).toBeLessThanOrEqual(0.25);
  });
});

describe("builds publicadas", () => {
  it("o corte por souls respeita orçamento e slots", () => {
    const build = { id: 1, name: "teste", matches: 1, wins: 1, optional: [], core: data.items.filter((i) => i.tier <= 3).slice(0, 20).map((i) => i.className) };
    const items = popularAtSouls(data, build, 6000, 9);
    expect(items.reduce((s, i) => s + i.cost, 0)).toBeLessThanOrEqual(6000);
    expect(items.length).toBeLessThanOrEqual(9);
    expect(items.length).toBeGreaterThan(0);
  });
});

describe("sinergia entre árvores", () => {
  const graph = buildGraph(data);

  it("cada item com parceiros mostra parceiros de outras árvores", () => {
    const groups = partnersByTree(graph, findItem(data, "Mystic Vulnerability"));
    expect(groups.weapon.length).toBeGreaterThan(0);
    expect(groups.vitality.length).toBeGreaterThan(0);
  });

  it("amplificação de dano liga a itens que causam dano", () => {
    const amp = data.items.find((i) => graph.itemNode.get(i.className)!.gives.damageAmp);
    const dealer = data.items.find((i) => i.slot !== amp?.slot && graph.itemNode.get(i.className)!.deals.length > 0);
    expect(amp && dealer).toBeTruthy();
    const links = linksBetween(graph.itemNode.get(amp!.className)!, graph.itemNode.get(dealer!.className)!);
    expect(links.some((l) => l.rule === "amp:damage")).toBe(true);
  });
});

describe("objetivo Otimizada", () => {
  it("maximiza dano e chega ao piso de defesa das builds mais jogadas", () => {
    const r = optimize(data, { hero: "Abrams", objective: "optimized", souls: 20_000 });
    const floor = r.weights.ehpFloor!;
    expect(floor).toBeGreaterThan(1);
    expect(r.metrics.ehp).toBeGreaterThanOrEqual(floor * r.baseline.ehp * 0.99);
    expect(r.metrics.totalDps).toBeGreaterThan(r.baseline.totalDps * 2);
  });

  it("vida abaixo do piso derruba a pontuação; acima ainda soma, com retorno menor que dano", () => {
    const base = { weaponDps: 1, abilityDps: 1, itemDps: 0, gunDps: 1, spiritDps: 1, totalDps: 100, ehp: 1000, sustain: 1, control: 0, meleeDps: 0, antiHealDps: 0, ampDps: 0, play: 0 };
    const w = { totalDps: 1, ehpFloor: 2 };
    const at = (ehp: number, dps = 300) => score({ ...base, totalDps: dps, ehp }, base, w);
    expect(at(2000)).toBeCloseTo(3);
    expect(at(1000)).toBeCloseTo(3 / 8);
    expect(at(2200)).toBeGreaterThan(at(2000));
    // 10% a mais de vida acima do piso vale menos que 10% a mais de dano.
    expect(at(2200) - at(2000)).toBeLessThan(at(2000, 330) - at(2000));
  });
});
