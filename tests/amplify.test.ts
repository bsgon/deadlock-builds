import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { evaluateBuild, findItem } from "../src/engine/index.ts";
import { amplification, stackingAverage } from "../src/optimizer/amplify.ts";
import { computeMetrics, fightSeconds } from "../src/optimizer/metrics.ts";
import { profileFromDeaths, type MatchDeaths } from "../src/meta/fights.ts";
import { scenarioMix } from "../src/combat/value.ts";

const data = loadSnapshot();
const build = (hero: string, items: string[] = [], tiers = [1, 1, 1, 1]) =>
  evaluateBuild(data, { hero, souls: 30000, abilityTiers: tiers, items: items.map((n) => findItem(data, n).className) });

describe("vulnerabilidade (amplificação de dano no alvo)", () => {
  it("acúmulos: somam por uso até o máximo e somem depois da duração", () => {
    // 3 acúmulos no início e mais 3 aos 3 s, máximo 5, 7% cada, duração 9 s, luta de 10 s.
    const r = stackingAverage([0, 3, 6, 9], 3, 5, 9, 7, 10);
    expect(r.peak).toBeCloseTo(35, 5);
    expect(r.average).toBeCloseTo((3 * 3 * 7 + 7 * 5 * 7) / 10, 0);
    // Um uso só, debuff de 2 s numa luta de 10 s: 20% do tempo.
    expect(stackingAverage([0], 1, 1, 2, 10, 10).average).toBeCloseTo(2.1, 1);
  });

  it("Malice amplifica todo o dano da Lady Geist; o T3 amplifica mais", () => {
    const t1 = amplification(build("Lady Geist"), 10, 0.5);
    const t3 = amplification(build("Lady Geist", [], [3, 3, 3, 3]), 10, 0.5);
    expect(t1.sources.map((s) => s.name)).toContain("Malice");
    expect(t1.bullet).toBeCloseTo(t1.spirit, 5);
    expect(t1.spirit).toBeGreaterThan(1.2);
    expect(t3.spirit).toBeGreaterThan(t1.spirit);
  });

  it("Escalating Exposure só amplifica spirit; Blasted só bala", () => {
    const seven = amplification(build("Seven", ["Escalating Exposure"]), 10, 0.5);
    expect(seven.spirit).toBeGreaterThan(1.1);
    expect(seven.bullet).toBe(1);
    const billy = amplification(build("Billy"), 10, 0.5);
    expect(billy.bullet).toBeGreaterThan(1);
    expect(billy.spirit).toBe(1);
  });

  it("entra no dano total como dano a mais (ampDps)", () => {
    const m = computeMetrics(build("Lady Geist"));
    expect(m.ampDps).toBeGreaterThan(0);
    const without = computeMetrics(build("Haze"));
    expect(without.ampDps).toBeCloseTo(0, 6);
  });
});

describe("perfil das lutas medido nas partidas", () => {
  it("agrupa mortes próximas em tempo e espaço; tamanho pelos heróis envolvidos", () => {
    const d = (t: number, victim: number, killer: number, x = 0, y = 0) => ({ t, victim, victimTeam: victim <= 6 ? 0 : 1, killer, x, y, ttk: 10 });
    const matches: MatchDeaths[] = [
      {
        id: 1,
        duration: 1800,
        deaths: [
          d(100, 1, 7), // duelo
          d(300, 2, 8, 0, 0), // luta de 6 heróis: 3 mortes em 10 s
          d(305, 9, 3, 200, 0),
          d(310, 4, 10, 100, 100),
          d(600, 5, 0), // tropa matou: não é luta entre heróis
        ],
      },
    ];
    const p = profileFromDeaths(matches, "");
    expect(p.fights).toBe(2);
    // Pesos pelas mortes: 1 no duelo, 3 na luta de 6.
    expect(p.sizes.duel).toBeCloseTo(0.25, 2);
    expect(p.sizes.teamfight).toBeCloseTo(0.75, 2);
    expect(Object.values(p.mix).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 2);
    expect(p.timeToKill.median).toBe(10);
  });

  it("o snapshot aplica a duração e a mistura medidas a todo o cálculo", () => {
    expect(data.fights).toBeDefined();
    expect(fightSeconds()).toBe(data.fights!.timeToKill.median);
    expect(scenarioMix().duel).toBe(data.fights!.mix.duel);
  });
});
