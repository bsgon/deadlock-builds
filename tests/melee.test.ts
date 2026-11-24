import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { evaluateBuild, findHero } from "../src/engine/index.ts";
import { DEFAULT_MELEE_SHARE, meleeShare } from "../src/meta/stats.ts";
import { computeMetrics, DEFAULT_METRIC_OPTIONS } from "../src/optimizer/metrics.ts";

const data = loadSnapshot();
const id = (name: string) => findHero(data, name).id;
const metrics = (hero: string, items: string[] = [], share?: number) =>
  computeMetrics(evaluateBuild(data, { hero, souls: 20000, items, uptime: DEFAULT_METRIC_OPTIONS.uptime, meleeShare: share }), DEFAULT_METRIC_OPTIONS);

describe("cura de itens", () => {
  it("Healing Rite, Healing Nova, Rescue Beam, Restorative Shot e Mystic Regeneration curam", () => {
    const base = metrics("Haze").sustain;
    for (const item of ["Healing Rite", "Healing Nova", "Rescue Beam", "Restorative Shot", "Mystic Regeneration", "Radiant Regeneration"]) {
      expect(metrics("Haze", [item]).sustain, item).toBeGreaterThan(base + 0.5);
    }
  });

  it("Healing Rite, que some ao levar dano, fica perto do Extra Regen, não muito acima", () => {
    const base = metrics("Haze").sustain;
    const rite = metrics("Haze", ["Healing Rite"]).sustain - base;
    const regen = metrics("Haze", ["Extra Regen"]).sustain - base;
    expect(rite).toBeGreaterThan(regen * 0.5);
    expect(rite).toBeLessThan(regen * 1.5);
  });

  it("bônus de cura (Healing Booster) aumenta a cura do Healing Rite", () => {
    expect(metrics("Haze", ["Healing Rite", "Healing Booster"]).sustain).toBeGreaterThan(metrics("Haze", ["Healing Rite"]).sustain);
  });
});

describe("uso de corpo a corpo por herói", () => {
  it("vem das compras de itens de melee: Billy e Abrams usam muito, Haze e Seven quase nada", () => {
    expect(meleeShare(data, id("Billy"))).toBeGreaterThan(0.8);
    expect(meleeShare(data, id("Abrams"))).toBeGreaterThan(0.8);
    expect(meleeShare(data, id("Haze"))).toBeLessThan(0.2);
    expect(meleeShare(data, id("Seven"))).toBeLessThan(0.2);
    for (const h of data.heroes) {
      const s = meleeShare(data, h.id);
      expect(s).toBeGreaterThanOrEqual(0.05);
      expect(s).toBeLessThanOrEqual(0.9);
    }
  });

  it("sem estatísticas, usa o padrão", () => {
    const { stats: _drop, ...noStats } = data;
    expect(meleeShare(noStats, id("Billy"))).toBe(DEFAULT_MELEE_SHARE);
  });

  it("Spirit Snatch e Lifestrike rendem mais em quem usa melee", () => {
    for (const item of ["Spirit Snatch", "Lifestrike", "Melee Lifesteal"]) {
      const gain = (hero: string) => {
        const base = metrics(hero);
        const with_ = metrics(hero, [item]);
        return with_.totalDps - base.totalDps + (with_.sustain - base.sustain) * 5;
      };
      expect(gain("Billy"), item).toBeGreaterThan(gain("Haze") * 2);
    }
  });

  it("o mesmo herói ganha mais com itens de melee quando usa mais melee", () => {
    const low = metrics("Haze", ["Lifestrike"], 0.1);
    const high = metrics("Haze", ["Lifestrike"], 0.9);
    expect(high.sustain).toBeGreaterThan(low.sustain);
    expect(high.meleeDps).toBeGreaterThan(low.meleeDps);
  });

  it("dano de melee cresce com bônus de dano de melee e entra no dano total", () => {
    const base = metrics("Abrams");
    const charged = metrics("Abrams", ["Melee Charge"]);
    expect(base.meleeDps).toBeGreaterThan(0);
    expect(charged.meleeDps).toBeGreaterThan(base.meleeDps);
    expect(base.totalDps).toBeCloseTo(base.weaponDps + base.abilityDps + base.itemDps + base.meleeDps);
  });
});

describe("golpes corpo a corpo e habilidades que escalam com eles", () => {
  const build = (hero: string, tier = 0, items: string[] = []) => evaluateBuild(data, { hero, souls: 50_000, items, itemSlots: 12, abilityTiers: [tier, tier, tier, tier] });

  it("crescem por boon como na wiki: Viscous 118,3 e 217,9; Abrams 110,9 e 257,1", () => {
    const viscous = build("Viscous");
    expect(viscous.progression.boons).toBe(35);
    expect(viscous.stats.lightMelee).toBeCloseTo(118.3, 1);
    expect(viscous.stats.heavyMelee).toBeCloseTo(217.8, 0);
    expect(build("Abrams").stats.lightMelee).toBeCloseTo(110.9, 0);
    expect(build("Abrams").stats.heavyMelee).toBeCloseTo(257.1, 0);
  });

  it("metade do bônus de dano de arma vale para o corpo a corpo", () => {
    const base = build("Viscous").stats;
    const item = data.items.find((i) => (i.innate.MODIFIER_VALUE_WEAPON_DAMAGE_INCREASE ?? 0) > 0 && !i.innate.MODIFIER_VALUE_MELEE_DAMAGE_INCREASE)!;
    const armed = build("Viscous", 0, [item.name]).stats;
    expect(armed.lightMelee / base.lightMelee).toBeCloseTo(1 + armed.weaponDamagePct / 200, 3);
  });

  it("Puddle Punch: 57,8 no nível 1; no upgrade 3 troca o golpe leve pelo pesado", () => {
    const punch = (b: ReturnType<typeof build>) => b.abilities.find((a) => a.name === "Puddle Punch")!.properties;
    const start = evaluateBuild(data, { hero: "Viscous", souls: 0, items: [] });
    expect(punch(start).Damage!.value).toBeCloseTo(57.8, 1);
    const max = build("Viscous", 3);
    expect(punch(max).Damage!.value).toBeCloseTo(0, 5);
    expect(punch(max).DamageHeavyMelee!.value).toBeCloseTo(40 + 0.6 * max.stats.heavyMelee, 3);
    expect(punch(max).Damage!.unresolved).toEqual([]);
  });

  it("o dano da habilidade conta como arma: cai com resistência a bala, não com a de spirit", () => {
    const b = build("Viscous", 3);
    const at = (bullet: number, spirit: number) => computeMetrics(b, { ...DEFAULT_METRIC_OPTIONS, targetBulletResist: bullet, targetSpiritResist: spirit });
    expect(at(50, 0).abilityDps).toBeLessThan(at(0, 0).abilityDps);
    expect(at(0, 50).gunDps).toBeCloseTo(at(0, 0).gunDps, 5);
    expect(at(0, 100).abilityDps).toBeGreaterThan(0);
  });
});
