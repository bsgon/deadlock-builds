import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { abilityPointsSpent, conditionalBonus, evaluateBuild, findItem, itemUptime, progressionFromSouls, MAX_ACTIVE_ITEMS } from "../src/engine/index.ts";
import { computeMetrics, score, type Metrics } from "../src/optimizer/metrics.ts";
import { tierGates } from "../src/meta/stats.ts";
import { optimize } from "../src/optimizer/optimize.ts";

const data = loadSnapshot();
const metricsOf = (hero: string, items: string[], uptime = 0.5) => computeMetrics(evaluateBuild(data, { hero, souls: 20_000, items, uptime }));

describe("efeitos condicionais", () => {
  it("uptime 0 mantém só os stats sempre ativos", () => {
    const off = evaluateBuild(data, { hero: "Infernus", souls: 20_000, items: ["Mystic Vulnerability"] });
    expect(off.conditional.spiritShredPct).toBe(0);
    const on = evaluateBuild(data, { hero: "Infernus", souls: 20_000, items: ["Mystic Vulnerability"], uptime: 0.5 });
    expect(on.conditional.spiritShredPct).toBeGreaterThan(0);
  });

  it("redução de resistência cresce com o uptime", () => {
    const item = [findItem(data, "Mystic Vulnerability")];
    expect(conditionalBonus(item, 1).spiritShredPct).toBeGreaterThan(conditionalBonus(item, 0.5).spiritShredPct);
  });

  it("item de imbuir vale para uma de quatro habilidades", () => {
    expect(itemUptime(findItem(data, "Compress Cooldown"), 0.9)).toBe(0.25);
  });

  it("bônus de 'próximo tiro' vale só para os tiros do proc, não para o tempo todo", () => {
    const item = findItem(data, "Express Shot");
    const key = item.conditional.find((k) => item.properties[k]!.provides === "MODIFIER_VALUE_WEAPON_DAMAGE_INCREASE")!;
    const factor = itemUptime(item, 0.5, key, 5);
    expect(factor).toBeLessThan(0.1);
    expect(factor).toBeGreaterThan(0);
    // Arma mais lenta: cada tiro do proc é uma fatia maior dos tiros.
    expect(itemUptime(item, 0.5, key, 1)).toBeGreaterThan(factor);
  });

  it("efeito passivo com duração e cooldown não passa de duração / cooldown", () => {
    const item = data.items.find((i) => {
      const d = i.properties.AbilityDuration?.value ?? 0;
      const c = i.properties.AbilityCooldown?.value ?? 0;
      return !i.isActive && d > 0 && c > d * 2 && i.conditional.length > 0 && !/imbue|your next|melee|parry|dash-jump/i.test(i.sections.map((s) => s.text).join(" "));
    });
    if (!item) return; // nenhum item do patch tem esse formato
    const cycle = item.properties.AbilityDuration!.value / item.properties.AbilityCooldown!.value;
    expect(itemUptime(item, 1, item.conditional[0])).toBeCloseTo(cycle);
  });

  it("bônus condicional positivo entra nos stats ponderado pelo uptime", () => {
    const base = evaluateBuild(data, { hero: "Infernus", souls: 20_000, items: ["Enchanter's Emblem"] });
    const cond = evaluateBuild(data, { hero: "Infernus", souls: 20_000, items: ["Enchanter's Emblem"], uptime: 1 });
    expect(cond.stats.spiritPower).toBeGreaterThan(base.stats.spiritPower);
  });
});

describe("métricas", () => {
  it("total é a soma de arma, habilidades, itens, corpo a corpo e vulnerabilidade", () => {
    const m = metricsOf("Infernus", ["Tesla Bullets", "Extra Spirit"]);
    // Napalm deixa o alvo vulnerável: o dano a mais entra como ampDps.
    expect(m.ampDps).toBeGreaterThan(0);
    expect(m.totalDps).toBeCloseTo(m.weaponDps + m.abilityDps + m.itemDps + m.meleeDps + m.ampDps + m.antiHealDps);
    expect(m.gunDps).toBeGreaterThan(m.weaponDps);
    // Dano de item disparado por bala conta para quem atira, não para o objetivo de spirit.
    expect(m.gunDps + m.spiritDps).toBeCloseTo(m.totalDps);
  });

  it("munição extra não aumenta o dano de arma quando a recarga já cabe nas pausas", () => {
    const opts = { uptime: 0.5, targetBulletResist: 0, targetSpiritResist: 0, targetHealth: 2500 };
    // Fração do DPS de pente cheio que vira dano: isola o efeito da recarga de qualquer outro bônus do item.
    const firing = (items: string[], shooting: number) => {
      const build = evaluateBuild(data, { hero: "Infernus", souls: 20_000, items, uptime: 0.5 });
      return computeMetrics(build, { ...opts, shooting }).weaponDps / build.stats.burstDps;
    };
    // Atirando 20% do tempo, a recarga cabe nas pausas com ou sem pente maior.
    expect(firing([], 0.2)).toBeCloseTo(0.2);
    expect(firing(["Titanic Magazine"], 0.2)).toBeCloseTo(0.2);
    // Atirando sem parar, o pente maior reduz o tempo perdido recarregando.
    expect(firing(["Titanic Magazine"], 1)).toBeGreaterThan(firing([], 1));
    expect(firing([], 1)).toBeLessThan(1);
  });

  it("Spirit Power aumenta o dano de habilidades e não o de arma do Infernus", () => {
    const base = metricsOf("Infernus", []);
    const spirit = metricsOf("Infernus", ["Extra Spirit"]);
    expect(spirit.abilityDps).toBeGreaterThan(base.abilityDps);
    expect(spirit.weaponDps).toBeCloseTo(base.weaponDps);
  });

  it("redução de resistência a spirit multiplica o dano de spirit", () => {
    const without = metricsOf("Infernus", [], 0.5);
    const withShred = metricsOf("Infernus", ["Mystic Vulnerability"], 0.5);
    expect(withShred.abilityDps).toBeGreaterThan(without.abilityDps);
  });

  it("efeito por bala rende mais em arma que acerta mais balas por segundo", () => {
    const rate = (hero: string) => {
      const s = evaluateBuild(data, { hero, souls: 20_000 }).stats;
      return s.shotsPerSecond * s.bulletsPerShot;
    };
    const [fast, slow] = rate("Haze") > rate("Lady Geist") ? ["Haze", "Lady Geist"] : ["Lady Geist", "Haze"];
    const dps = (hero: string) => metricsOf(hero, ["Tesla Bullets"]).itemDps;
    expect(dps(fast!)).toBeGreaterThan(dps(slow!));
  });

  it("pontuação 1,0 para a própria referência e proporcional ao ganho", () => {
    const base = metricsOf("Abrams", []);
    expect(score(base, base, { ehp: 1 })).toBeCloseTo(1);
    const doubled: Metrics = { ...base, ehp: base.ehp * 2 };
    expect(score(doubled, base, { ehp: 1 })).toBeCloseTo(2);
    expect(score(doubled, base, { ehp: 0.5, totalDps: 0.5 })).toBeCloseTo(1.5);
  });
});

describe("otimizador", () => {
  const souls = 15_000;
  const dps = optimize(data, { hero: "Infernus", souls, objective: "dps" });
  const tank = optimize(data, { hero: "Infernus", souls, objective: "tank" });

  it("respeita souls, slots, itens ativos e tier máximo", () => {
    for (const r of [dps, tank]) {
      expect(r.spent).toBeLessThanOrEqual(souls);
      // Souls usados incluem a espera por tiers e a perda nas vendas, então passam do preço dos itens.
      expect(r.spent).toBeGreaterThanOrEqual(r.items.reduce((s, i) => s + i.cost, 0));
      expect(r.items.length).toBeLessThanOrEqual(9);
      expect(r.items.filter((i) => i.isActive).length).toBeLessThanOrEqual(MAX_ACTIVE_ITEMS);
      expect(Math.max(...r.items.map((i) => i.tier))).toBeLessThanOrEqual(4);
      expect(new Set(r.items.map((i) => i.className)).size).toBe(r.items.length);
    }
  });

  it("melhora a build sem itens", () => {
    expect(dps.score).toBeGreaterThan(1);
    expect(tank.score).toBeGreaterThan(1);
  });

  it("objetivos diferentes levam a builds diferentes na direção certa", () => {
    expect(dps.metrics.totalDps).toBeGreaterThan(tank.metrics.totalDps);
    expect(tank.metrics.ehp).toBeGreaterThan(dps.metrics.ehp);
  });

  it("upgrades de habilidade cabem nos pontos do nível", () => {
    const prog = progressionFromSouls(data.shared, souls);
    expect(abilityPointsSpent(dps.abilityTiers)).toBeLessThanOrEqual(prog.abilityPoints);
    dps.abilityTiers.forEach((tier, slot) => {
      if (slot >= prog.abilityUnlocks) expect(tier).toBe(0);
    });
  });

  it("ordem de compra termina na build final e os souls só crescem", () => {
    const final = dps.order.filter((s) => !s.isComponent && !s.soldLater).map((s) => s.item.className).sort();
    expect(final).toEqual(dps.items.map((i) => i.className).sort());
    expect(dps.order.at(-1)!.earned).toBe(dps.spent);
    let previous = 0;
    for (const step of dps.order) {
      expect(step.cost).toBeGreaterThan(0);
      // Cada compra precisa juntar o preço; pode esperar mais, até o tier liberar.
      expect(step.earned).toBeGreaterThanOrEqual(previous + step.cost);
      previous = step.earned;
    }
  });

  it("compra a compra respeita quando cada tier costuma aparecer", () => {
    const hero = data.heroes.find((h) => h.name === "Infernus")!;
    const gates = tierGates(data, hero.id);
    for (const step of dps.order) expect(step.earned).toBeGreaterThanOrEqual(gates[step.item.tier]!);
    // Nada de 3.200 souls antes de o herói costumar comprar esse tier.
    expect(gates[3]).toBeGreaterThan(7000);
  });

  it("vender um item devolve metade do preço e libera o slot", () => {
    const r = optimize(data, { hero: "Haze", souls: 30_000, objective: "dps" });
    for (const step of r.order.filter((s) => s.sold)) {
      expect(r.items.some((i) => i.className === step.sold!.className)).toBe(false);
    }
    expect(r.items.length).toBeLessThanOrEqual(9);
  });

  it("modo final escolhe a build para os souls finais e soma o gasto exato", () => {
    const r = optimize(data, { hero: "Infernus", souls, objective: "dps", mode: "final" });
    expect(r.spent).toBe(r.items.reduce((s, i) => s + i.cost, 0));
    let previous = 0;
    for (const step of r.order) {
      expect(step.spent).toBe(previous + step.cost);
      previous = step.spent;
    }
  });

  it("obedece itens obrigatórios e proibidos", () => {
    const banned = dps.items[0]!.name;
    const r = optimize(data, { hero: "Infernus", souls, objective: "dps", required: ["Extra Stamina"], banned: [banned] });
    expect(r.items.map((i) => i.name)).toContain("Extra Stamina");
    expect(r.items.map((i) => i.name)).not.toContain(banned);
  });

  it("com poucos souls compra só o que cabe", () => {
    const r = optimize(data, { hero: "Haze", souls: 800, objective: "weapon" });
    expect(r.items.length).toBeLessThanOrEqual(1);
    expect(r.spent).toBeLessThanOrEqual(800);
  });

  it("funciona para todos os heróis", () => {
    for (const hero of data.heroes) {
      const r = optimize(data, { hero: hero.name, souls: 6_400, objective: "bruiser" });
      expect(Number.isFinite(r.score), hero.name).toBe(true);
      expect(r.spent, hero.name).toBeLessThanOrEqual(6_400);
    }
  }, 60_000);
});

describe("dano de itens por bala", () => {
  const itemDps = (hero: string, items: string[]) => computeMetrics(evaluateBuild(data, { hero, souls: 20_000, items, uptime: 0.5 })).itemDps;

  it("bônus em % por bala é fração do dano da bala, não dano fixo", () => {
    const item = findItem(data, "Mercurial Magnum");
    const key = item.sections.flatMap((s) => s.important).find((k) => /BulletsBonus/.test(k))!;
    expect(item.properties[key]!.unit).toBe("%");
    // Com dano fixo, Haze passava de 400 de DPS só com este item.
    expect(itemDps("Haze", ["Mercurial Magnum"])).toBeLessThan(40);
  });

  it("sangramento em % da vida do alvo conta como dano", () => {
    const dps = itemDps("Haze", ["Toxic Bullets"]);
    expect(dps).toBeGreaterThan(0);
    // No máximo a % por segundo sobre a vida do alvo de referência.
    expect(dps).toBeLessThan(0.05 * 2500);
  });

  it("duração não é contada como dano", () => {
    expect(itemDps("Haze", ["Berserker"])).toBe(0);
  });
});

describe("habilidades bloqueadas", () => {
  it("não entram no dano: com 2 habilidades liberadas, o dano é o dessas 2", () => {
    const early = evaluateBuild(data, { hero: "Seven", souls: 800, uptime: 0.5 });
    expect(early.progression.abilityUnlocks).toBeLessThan(4);
    const only = { ...early, abilities: early.abilities.filter((a) => a.slot <= early.progression.abilityUnlocks) };
    expect(computeMetrics(early).abilityDps).toBeCloseTo(computeMetrics(only).abilityDps);
    const late = evaluateBuild(data, { hero: "Seven", souls: 20000, uptime: 0.5 });
    expect(computeMetrics(late).abilityDps).toBeGreaterThan(computeMetrics(early).abilityDps);
  });
});
