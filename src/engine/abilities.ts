import type { Ability, Property, PropertyUpgrade, Scale } from "../data/types.ts";
import type { HeroStats } from "./stats.ts";

export interface ResolvedProperty {
  label: string | null;
  unit: string;
  /** Valor base depois dos upgrades de habilidade, antes dos stats do herói. */
  base: number;
  /** Valor final com Spirit Power, cooldown, duração e alcance aplicados. */
  value: number;
  /** Coeficiente de escala depois dos upgrades (null se a propriedade não escala). */
  coef: number | null;
  /** Stats de escala que o motor ainda não sabe aplicar (o valor final os ignora). */
  unresolved: string[];
}

export interface ResolvedAbility {
  className: string;
  name: string;
  slot: number;
  tier: number;
  /** Descrição da habilidade (alguns efeitos só aparecem nela). */
  text: string;
  properties: Record<string, ResolvedProperty>;
}

/** Stats que somam `coef x stat` ao valor base. */
function powerStat(stat: string, stats: HeroStats, boons: number): number | null {
  switch (stat) {
    case "ETechPower":
      return stats.spiritPower;
    case "ELevelUpBoons":
      return boons;
    case "EWeaponPower":
    case "EBaseWeaponDamageIncrease":
      return stats.weaponDamagePct;
    default:
      return null;
  }
}

/** Stats que multiplicam o valor depois da soma. */
function multiplier(stat: string, stats: HeroStats): number | null {
  switch (stat) {
    case "ETechCooldown":
      return 1 - stats.cooldownReductionPct / 100;
    case "EItemCooldown":
      return 1 - stats.itemCooldownReductionPct / 100;
    case "ETechDuration":
      return 1 + stats.durationPct / 100;
    case "ETechRange":
      return 1 + stats.rangePct / 100;
    case "ETechRadius":
      return 1 + stats.radiusPct / 100;
    case "EHealingOutput":
      return 1 + stats.healingOutputPct / 100;
    case "EChannelDuration":
      // Nenhum item do snapshot altera duração de canalização de forma inata.
      return 1;
    default:
      return null;
  }
}

/**
 * Stats que só multiplicam (cooldown, duração, alcance...). Quando uma escala
 * tem coeficiente mas declara apenas stats deste tipo, o coeficiente é de
 * Spirit Power (ex.: duração que cresce com spirit).
 */
const MULTIPLIER_ONLY = new Set(["ETechCooldown", "EItemCooldown", "ETechDuration", "ETechRange", "ETechRadius", "EHealingOutput", "EChannelDuration"]);

/** Stat implícito de funções de escala que vêm sem a lista de stats. */
const IMPLIED_STAT: Record<string, string> = {
  scale_function_tech_duration: "ETechDuration",
  scale_function_tech_range: "ETechRange",
  scale_function_tech_range_rounded: "ETechRange",
  // Curas de item: o bônus de cura (Healing Booster) multiplica o valor.
  scale_function_healing_spirit_scale: "EHealingOutput",
  scale_function_healing_boon_scale: "EHealingOutput",
};

function applyUpgrade(prop: Property, coef: number | null, up: PropertyUpgrade): { base: number; coef: number | null } {
  switch (up.type) {
    case "addBase":
      return { base: prop.value + up.bonus, coef };
    case "mulBase":
      return { base: prop.value * up.bonus, coef };
    case "addScale":
      return { base: prop.value, coef: (coef ?? 0) + up.bonus };
    case "mulScale":
      return { base: prop.value, coef: coef === null ? null : coef * up.bonus };
  }
}

function resolveProperty(prop: Property, coef: number | null, stats: HeroStats, boons: number, isCharges: boolean): ResolvedProperty {
  const scale: Scale | null = prop.scale;
  const unresolved: string[] = [];
  let value = prop.value;

  if (scale) {
    const statList = [...scale.stats];
    // Algumas funções de escala não declaram o stat, mas o nome já diz qual é
    // (ex.: 150 durações usam "scale_function_tech_duration" sem stats).
    const implied = scale.fn ? IMPLIED_STAT[scale.fn] : undefined;
    if (implied && !statList.includes(implied)) statList.push(implied);
    if (coef !== null) {
      // O coeficiente pertence ao primeiro stat de "poder" declarado; sem nenhum, é Spirit Power.
      let applied = false;
      for (const stat of statList) {
        const power = powerStat(stat, stats, boons);
        if (power !== null) {
          value += coef * power;
          applied = true;
          break;
        }
      }
      if (!applied) {
        // Curas e barreiras com função "boon" crescem por boon, não por Spirit Power.
        if (scale.fn?.includes("boon")) value += coef * boons;
        else if (statList.every((s) => MULTIPLIER_ONLY.has(s))) value += coef * stats.spiritPower;
        else unresolved.push(`coef:${statList.join("+")}`);
      }
    }
    for (const stat of statList) {
      const mult = multiplier(stat, stats);
      if (mult !== null) value *= mult;
      else if (powerStat(stat, stats, boons) === null) unresolved.push(stat);
    }
    // Cargas extras só valem para habilidades que já têm cargas.
    if (isCharges && scale.fn === "scale_function_ability_charges" && prop.value >= 1) value += stats.bonusCharges;
  }

  return { label: prop.label, unit: prop.unit, base: prop.value, value, coef, unresolved };
}

/**
 * Resolve os números de uma habilidade para um conjunto de stats.
 * `tier` é quantos upgrades da habilidade estão comprados (0 a 3).
 */
export function resolveAbility(ability: Ability, stats: HeroStats, boons: number, tier = 0): ResolvedAbility {
  const properties = resolveProperties(ability.properties, ability.upgrades, stats, boons, tier);
  return { className: ability.className, name: ability.name, slot: ability.slot, tier, text: ability.text ?? "", properties };
}

/** Resolve um conjunto de propriedades (de habilidade ou de item) para os stats dados. */
export function resolveProperties(
  source: Record<string, Property>,
  upgradeTiers: PropertyUpgrade[][],
  stats: HeroStats,
  boons: number,
  tier = 0,
): Record<string, ResolvedProperty> {
  const props: Record<string, Property> = {};
  const coefs: Record<string, number | null> = {};
  for (const [key, p] of Object.entries(source)) {
    props[key] = { ...p };
    coefs[key] = p.scale?.coef ?? null;
  }

  for (const upgrades of upgradeTiers.slice(0, Math.max(0, Math.min(3, tier)))) {
    for (const up of upgrades) {
      const prop = props[up.property];
      if (!prop) continue;
      const next = applyUpgrade(prop, coefs[up.property] ?? null, up);
      prop.value = next.base;
      coefs[up.property] = next.coef;
    }
  }

  const properties: Record<string, ResolvedProperty> = {};
  for (const [key, p] of Object.entries(props)) {
    properties[key] = resolveProperty(p, coefs[key] ?? null, stats, boons, key === "AbilityCharges");
  }
  return properties;
}
