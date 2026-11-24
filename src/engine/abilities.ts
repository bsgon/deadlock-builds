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
      // Porcentagem somada à base (Ground Strike T3: "Damage Per Meter +120%"). Já mulScale é fator.
      return { base: prop.value * (1 + up.bonus / 100), coef };
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

/**
 * Resultados já resolvidos por fonte. O resultado só depende das propriedades, dos
 * upgrades aplicados e dos stats que powerStat/multiplier/cargas leem (a chave), e
 * ninguém altera o objeto devolvido: a mesma fonte com os mesmos stats reaproveita.
 */
type ByStats = Map<string, Record<string, ResolvedProperty>>;
type ResolvedCache = { deps: Dep[]; depsId: string; plain: ByStats; upgraded: WeakMap<PropertyUpgrade[][], Map<number, ByStats>> };
const resolvedCache = new WeakMap<Record<string, Property>, ResolvedCache>();
const RESOLVED_CACHE_LIMIT = 4000;

/** Valores que a resolução pode ler: campos dos stats e os boons. */
type Dep = "spiritPower" | "boons" | "weaponDamagePct" | "cooldownReductionPct" | "itemCooldownReductionPct" | "durationPct" | "rangePct" | "radiusPct" | "healingOutputPct" | "bonusCharges";
const DEP_ORDER: Dep[] = ["spiritPower", "boons", "weaponDamagePct", "cooldownReductionPct", "itemCooldownReductionPct", "durationPct", "rangePct", "radiusPct", "healingOutputPct", "bonusCharges"];
/** Campo lido por powerStat/multiplier para cada stat de escala (EChannelDuration é constante). */
const STAT_DEP: Record<string, Dep> = {
  ETechPower: "spiritPower",
  ELevelUpBoons: "boons",
  EWeaponPower: "weaponDamagePct",
  EBaseWeaponDamageIncrease: "weaponDamagePct",
  ETechCooldown: "cooldownReductionPct",
  EItemCooldown: "itemCooldownReductionPct",
  ETechDuration: "durationPct",
  ETechRange: "rangePct",
  ETechRadius: "radiusPct",
  EHealingOutput: "healingOutputPct",
};

/**
 * O que a resolução da fonte pode ler (com folga): propriedade sem escala não lê nada;
 * com escala, os stats declarados ou implícitos, Spirit Power e boons (coeficientes sem
 * stat de poder) e cargas extras. Fonte sem escala nenhuma dá o mesmo resultado em qualquer build.
 */
function dependencies(source: Record<string, Property>): Dep[] {
  const deps = new Set<Dep>();
  for (const [key, p] of Object.entries(source)) {
    const scale = p.scale;
    if (!scale) continue;
    deps.add("spiritPower");
    deps.add("boons");
    const implied = scale.fn ? IMPLIED_STAT[scale.fn] : undefined;
    for (const stat of implied ? [...scale.stats, implied] : scale.stats) {
      const dep = STAT_DEP[stat];
      if (dep) deps.add(dep);
    }
    if (key === "AbilityCharges") deps.add("bonusCharges");
  }
  return DEP_ORDER.filter((d) => deps.has(d));
}

/** Chave dos valores lidos, guardada por objeto de stats (que não muda depois de calculado). */
const statsKeys = new WeakMap<HeroStats, { boons: number; keys: Map<string, string> }>();
function statsKey(stats: HeroStats, boons: number, deps: Dep[], depsId: string): string {
  let entry = statsKeys.get(stats);
  if (!entry || !Object.is(entry.boons, boons)) statsKeys.set(stats, (entry = { boons, keys: new Map() }));
  let key = entry.keys.get(depsId);
  if (key === undefined) entry.keys.set(depsId, (key = deps.map((d) => (d === "boons" ? boons : stats[d])).join("|")));
  return key;
}

/** Resolve um conjunto de propriedades (de habilidade ou de item) para os stats dados. */
export function resolveProperties(
  source: Record<string, Property>,
  upgradeTiers: PropertyUpgrade[][],
  stats: HeroStats,
  boons: number,
  tier = 0,
): Record<string, ResolvedProperty> {
  // Quantos níveis de upgrade entram (o mesmo que upgradeTiers.slice(0, ...).length).
  const end = Math.max(0, Math.min(3, tier));
  const count = end > 0 ? Math.min(upgradeTiers.length, Math.trunc(end)) : 0;
  let bySource = resolvedCache.get(source);
  if (!bySource) {
    const deps = dependencies(source);
    resolvedCache.set(source, (bySource = { deps, depsId: deps.join(","), plain: new Map(), upgraded: new WeakMap() }));
  }
  let cache = bySource.plain;
  if (count > 0) {
    let up = bySource.upgraded.get(upgradeTiers);
    if (!up) bySource.upgraded.set(upgradeTiers, (up = new Map()));
    let byCount = up.get(count);
    if (!byCount) up.set(count, (byCount = new Map()));
    cache = byCount;
  }
  const key = statsKey(stats, boons, bySource.deps, bySource.depsId);
  const hit = cache.get(key);
  if (hit) return hit;
  const resolved = resolvePropertiesUncached(source, upgradeTiers.slice(0, count), stats, boons);
  if (cache.size >= RESOLVED_CACHE_LIMIT) cache.clear();
  cache.set(key, resolved);
  return resolved;
}

function resolvePropertiesUncached(source: Record<string, Property>, applied: PropertyUpgrade[][], stats: HeroStats, boons: number): Record<string, ResolvedProperty> {
  const props: Record<string, Property> = {};
  const coefs: Record<string, number | null> = {};
  for (const [key, p] of Object.entries(source)) {
    props[key] = { ...p };
    coefs[key] = p.scale?.coef ?? null;
  }

  for (const upgrades of applied) {
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
