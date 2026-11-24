import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { parseValue, stripHtml } from "../src/data/normalize.ts";
import {
  abilityPointsSpent,
  effectiveHealth,
  evaluateBuild,
  finalResist,
  findHero,
  findItem,
  investmentBonus,
  progressionFromSouls,
  soulsForLevel,
  stackMultiplicative,
} from "../src/engine/index.ts";

const data = loadSnapshot();
const M = "MODIFIER_VALUE_";

/**
 * As expectativas são recalculadas à mão a partir dos valores do snapshot,
 * então os testes continuam válidos quando um patch muda os números.
 * Eles provam que o motor aplica as fórmulas declaradas, não que as fórmulas
 * batem com o jogo: isso é conferido em jogo com `npm run report`.
 */

describe("normalização", () => {
  it("lê números com unidade", () => {
    expect(parseValue("20m")).toEqual({ value: 20, unit: "m" });
    expect(parseValue("-1.0")).toEqual({ value: -1, unit: "" });
    expect(parseValue(0.6)).toEqual({ value: 0.6, unit: "" });
    expect(parseValue("asdasd")).toBeNull();
  });

  it("remove SVG e tags das descrições", () => {
    expect(stripHtml('Deals <svg viewBox="0 0 1 1"><path d="M0"/></svg><span class="x">spirit damage</span>.')).toBe("Deals spirit damage.");
  });

  it("snapshot tem heróis completos e itens com preço de tier", () => {
    expect(data.heroes.length).toBeGreaterThanOrEqual(40);
    for (const hero of data.heroes) {
      expect(hero.abilities, hero.name).toHaveLength(4);
      expect(data.abilities.filter((a) => a.heroId === hero.id), hero.name).toHaveLength(4);
      expect(hero.weapon.bulletDamage, hero.name).toBeGreaterThan(0);
      expect(hero.weapon.shotsPerSecond, hero.name).toBeGreaterThan(0);
    }
    for (const item of data.items) {
      expect(item.cost, item.name).toBe(data.shared.tierPrices[item.tier]);
    }
  });

  it("componentes apontam para itens existentes da loja", () => {
    const classes = new Set(data.items.map((i) => i.className));
    const missing = data.items.flatMap((i) => i.components.filter((c) => !classes.has(c)).map((c) => `${i.name} -> ${c}`));
    expect(missing).toEqual([]);
  });
});

describe("progressão", () => {
  it("nível sobe nos marcos de souls da tabela", () => {
    expect(progressionFromSouls(data.shared, 0).level).toBe(1);
    const lvl5 = soulsForLevel(data.shared, 5);
    expect(progressionFromSouls(data.shared, lvl5 - 1).level).toBe(4);
    expect(progressionFromSouls(data.shared, lvl5).level).toBe(5);
  });

  it("no nível máximo há 4 habilidades e pontos para todos os upgrades", () => {
    const max = progressionFromSouls(data.shared, 1_000_000);
    expect(max.abilityUnlocks).toBe(4);
    expect(max.soulsToNext).toBeNull();
    expect(max.abilityPoints).toBe(abilityPointsSpent([3, 3, 3, 3]));
  });

  it("custo de upgrades é 1, 2 e 5 pontos", () => {
    expect(abilityPointsSpent([1, 0, 0, 0])).toBe(1);
    expect(abilityPointsSpent([2, 1, 0, 0])).toBe(4);
    expect(abilityPointsSpent([3, 0, 0, 0])).toBe(8);
  });

  it("bônus de investimento usa o maior degrau atingido", () => {
    const steps = data.shared.investment.spirit;
    expect(investmentBonus(steps, steps[0]!.souls - 1)).toBe(0);
    expect(investmentBonus(steps, steps[0]!.souls)).toBe(steps[0]!.bonus);
    expect(investmentBonus(steps, 10_000_000)).toBe(steps.at(-1)!.bonus);
  });
});

describe("resistências", () => {
  it("empilha multiplicativamente", () => {
    expect(stackMultiplicative([40, 20])).toBeCloseTo(52);
    expect(stackMultiplicative([])).toBe(0);
  });

  it("subtrai a redução empilhada e permite resistência negativa", () => {
    expect(finalResist([40, 20], [25, 20])).toBeCloseTo(12);
    expect(finalResist([], [-30])).toBeCloseTo(-30);
    expect(effectiveHealth(1000, 50)).toBeCloseTo(2000);
    expect(effectiveHealth(1000, -30)).toBeCloseTo(1000 / 1.3);
  });
});

describe("Infernus (arma)", () => {
  const hero = findHero(data, "Infernus");

  it("sem itens no nível 1 reproduz os valores base da arma", () => {
    const { stats } = evaluateBuild(data, { hero: "Infernus", souls: 0 });
    const w = hero.weapon;
    expect(stats.bulletDamage).toBeCloseTo(w.bulletDamage);
    expect(stats.burstDps).toBeCloseTo(w.bulletDamage * w.bullets * w.shotsPerSecond);
    expect(stats.sustainedDps).toBeCloseTo((w.bulletDamage * w.bullets * w.clipSize) / (w.clipSize / w.shotsPerSecond + w.reloadTime));
    expect(stats.health).toBeCloseTo(hero.start.max_health!);
    expect(stats.spiritPower).toBe(0);
  });

  it("boons e investimento em weapon aumentam o dano da bala", () => {
    const item = findItem(data, "Headshot Booster");
    const souls = soulsForLevel(data.shared, 10);
    const r = evaluateBuild(data, { hero: "Infernus", souls, items: [item.name] });
    const pct = investmentBonus(data.shared.investment.weapon, item.cost) + (item.innate[`${M}WEAPON_DAMAGE_INCREASE`] ?? 0);
    const base = hero.weapon.bulletDamage + 9 * hero.perBoon[`${M}BASE_BULLET_DAMAGE_FROM_LEVEL`]!;
    expect(r.progression.boons).toBe(9);
    expect(r.stats.bulletDamage).toBeCloseTo(base * (1 + pct / 100));
    expect(r.warnings).toEqual([]);
  });
});

describe("Haze (spirit e escalas próprias)", () => {
  const hero = findHero(data, "Haze");
  const extraSpirit = findItem(data, "Extra Spirit");

  it("Spirit Power soma boons, investimento e itens", () => {
    const souls = soulsForLevel(data.shared, 6);
    const r = evaluateBuild(data, { hero: "Haze", souls, items: ["Extra Spirit"] });
    const expected =
      5 * hero.perBoon[`${M}TECH_POWER`]! +
      investmentBonus(data.shared.investment.spirit, extraSpirit.cost) +
      extraSpirit.innate[`${M}TECH_POWER`]!;
    expect(r.stats.spiritPower).toBeCloseTo(expected);
  });

  it("dano de habilidade segue base + coeficiente x Spirit Power", () => {
    const r = evaluateBuild(data, { hero: "Haze", souls: soulsForLevel(data.shared, 6), items: ["Extra Spirit"] });
    const raw = data.abilities.find((a) => a.className === hero.abilities[0])!.properties.Damage!;
    const dagger = r.abilities[0]!.properties.Damage!;
    expect(raw.scale?.coef).toBeGreaterThan(0);
    expect(dagger.value).toBeCloseTo(raw.value + raw.scale!.coef! * r.stats.spiritPower);
  });

  it("pente cresce com Spirit Power", () => {
    const scale = hero.scaling.find((s) => s.stat === "EClipSize")!.scale;
    const r = evaluateBuild(data, { hero: "Haze", souls: soulsForLevel(data.shared, 6), items: ["Extra Spirit"] });
    expect(r.stats.clipSize).toBe(Math.round(hero.weapon.clipSize + scale * r.stats.spiritPower));
  });
});

describe("Abrams (tank)", () => {
  const hero = findHero(data, "Abrams");

  it("vida = base x investimento em vitality + vida de itens", () => {
    const item = findItem(data, "Extra Health");
    const r = evaluateBuild(data, { hero: "Abrams", souls: soulsForLevel(data.shared, 4), items: [item.name] });
    const base = hero.start.max_health! + 3 * hero.perBoon[`${M}BASE_HEALTH_FROM_LEVEL`]!;
    const pct = investmentBonus(data.shared.investment.vitality, item.cost);
    expect(r.stats.health).toBeCloseTo(base * (1 + pct / 100) + item.innate[`${M}HEALTH_MAX`]!);
  });

  it("resistência de item gera vida efetiva maior só contra aquele tipo de dano", () => {
    const item = data.items.find((i) => (i.innate[`${M}BULLET_ARMOR_DAMAGE_RESIST`] ?? 0) > 0 && !i.innate[`${M}TECH_RESIST`])!;
    const r = evaluateBuild(data, { hero: "Abrams", souls: 50_000, items: [item.name] });
    expect(r.stats.bulletResist).toBeCloseTo(item.innate[`${M}BULLET_ARMOR_DAMAGE_RESIST`]!);
    expect(r.stats.ehpBullet).toBeGreaterThan(r.stats.health);
    expect(r.stats.ehpSpirit).toBeCloseTo(r.stats.health);
  });

  it("upgrades de habilidade somam ao valor base da propriedade", () => {
    const ability = data.abilities.find((a) => a.className === hero.abilities[0])!;
    const up = ability.upgrades[0]!.find((u) => u.type === "addBase" && ability.properties[u.property])!;
    const souls = 50_000;
    const before = evaluateBuild(data, { hero: "Abrams", souls }).abilities[0]!.properties[up.property]!;
    const after = evaluateBuild(data, { hero: "Abrams", souls, abilityTiers: [1, 0, 0, 0] }).abilities[0]!.properties[up.property]!;
    expect(after.base).toBeCloseTo(before.base + up.bonus);
  });
});

describe("validação de build", () => {
  it("avisa quando faltam souls, slots ou pontos de habilidade", () => {
    const names = data.items.filter((i) => i.components.length === 0 && !i.isActive).slice(0, 10).map((i) => i.name);
    const r = evaluateBuild(data, { hero: "Infernus", souls: 0, items: names, abilityTiers: [3, 0, 0, 0] });
    expect(r.warnings.some((w) => w.includes("slots"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("souls"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("pontos"))).toBe(true);
  });

  it("componente absorvido por item melhorado não conta duas vezes", () => {
    const upgraded = data.items.find((i) => i.components.length === 1)!;
    const component = data.items.find((i) => i.className === upgraded.components[0])!;
    const r = evaluateBuild(data, { hero: "Infernus", souls: 50_000, items: [component.name, upgraded.name] });
    expect(r.items.map((i) => i.name)).toEqual([upgraded.name]);
    expect(r.spending.total).toBe(upgraded.cost);
  });

  it("todos os heróis produzem números finitos com uma build genérica", () => {
    for (const hero of data.heroes) {
      const r = evaluateBuild(data, { hero: hero.name, souls: 20_000, items: ["Extra Spirit", "Extra Health"], abilityTiers: [1, 1, 1, 1] });
      for (const key of ["bulletDamage", "burstDps", "sustainedDps", "health", "spiritPower", "ehpBullet", "ehpSpirit"] as const) {
        expect(Number.isFinite(r.stats[key]), `${hero.name}.${key}`).toBe(true);
        expect(r.stats[key], `${hero.name}.${key}`).toBeGreaterThanOrEqual(0);
      }
      for (const a of r.abilities) for (const [k, p] of Object.entries(a.properties)) expect(Number.isFinite(p.value), `${hero.name}/${a.name}/${k}`).toBe(true);
    }
  });
});

describe("upgrades que multiplicam", () => {
  const prop = (hero: string, ability: string, property: string, tier: number) =>
    evaluateBuild(data, { hero, souls: 50_000, items: [], abilityTiers: [tier, tier, tier, tier] }).abilities.find((a) => a.name === ability)!.properties[property]!.value;

  it("multiplicar a base é porcentagem: Brew Effectiveness +33,33%", () => {
    expect(prop("Baba", "Baba's Brew", "SilenceDuration", 3)).toBeCloseTo(2.75 * 1.3333, 3);
    expect(prop("Baba", "Baba's Brew", "SpiritResistReduction", 3)).toBeCloseTo(-15 * 1.3333, 2);
    // Base (+33,33%) e escala (×1,3333) crescem juntas.
    expect(prop("Baba", "Baba's Brew", "DamagePerSecond", 3) / prop("Baba", "Baba's Brew", "DamagePerSecond", 2)).toBeCloseTo(1.3333, 3);
  });

  it("Ground Strike: Damage Per Meter +120%, com a escala melhorada somada", () => {
    const t2 = prop("Lash", "Ground Strike", "StompDamagePerMeterPrimary", 2);
    // A escala soma 0,04 por ponto de Spirit, igual à base: o dobro da parte de Spirit.
    expect(prop("Lash", "Ground Strike", "StompDamagePerMeterPrimary", 3)).toBeCloseTo(5.5 * 2.2 + (t2 - 5.5) * 2, 3);
  });
});
