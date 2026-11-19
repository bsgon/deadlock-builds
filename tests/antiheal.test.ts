import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { evaluateBuild } from "../src/engine/index.ts";
import { computeMetrics } from "../src/optimizer/metrics.ts";
import { antiHealSources, enemyHealPerDamage } from "../src/optimizer/antiheal.ts";

const data = loadSnapshot();
const metrics = (hero: string, items: string[], souls = 30000) => computeMetrics(evaluateBuild(data, { hero, items, souls, uptime: 0.5 }));

describe("anti-cura", () => {
  it("o inimigo cura mais por dano no fim de jogo", () => {
    expect(enemyHealPerDamage(2000)).toBeLessThan(enemyHealPerDamage(40000));
    expect(enemyHealPerDamage(90000)).toBeCloseTo(0.37);
  });

  it("Healbane vira dano equivalente para quem causa dano spirit", () => {
    const without = metrics("Haze", ["Extra Spirit"]);
    const withIt = metrics("Haze", ["Extra Spirit", "Healbane"]);
    expect(without.antiHealDps).toBe(0);
    expect(withIt.antiHealDps).toBeGreaterThan(0);
    expect(withIt.totalDps).toBeCloseTo(withIt.weaponDps + withIt.abilityDps + withIt.itemDps + withIt.meleeDps + withIt.antiHealDps);
    expect(withIt.gunDps + withIt.spiritDps).toBeCloseTo(withIt.totalDps);
  });

  it("Spirit Burn reduz mais que Healbane, e as duas não se somam", () => {
    const bane = metrics("Infernus", ["Healbane"]).antiHealDps / metrics("Infernus", ["Healbane"]).totalDps;
    const burn = metrics("Infernus", ["Spirit Burn"]);
    const both = metrics("Infernus", ["Spirit Burn", "Healbane"]);
    expect(burn.antiHealDps / burn.totalDps).toBeGreaterThan(bane);
    expect(both.antiHealDps / both.totalDps).toBeCloseTo(burn.antiHealDps / burn.totalDps, 2);
  });

  it("Cheat Death reduz a cura de quem usa, não do inimigo", () => {
    const build = evaluateBuild(data, { hero: "Abrams", items: ["Cheat Death"], souls: 40000, uptime: 0.5 });
    expect(antiHealSources(build, 0.5, 0.5, 10)).toHaveLength(0);
  });
});
