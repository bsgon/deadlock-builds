/**
 * Converte as respostas cruas do deadlock-api.com no formato enxuto de types.ts.
 * Funções puras: não fazem rede nem disco.
 */
import type {
  Ability,
  GameData,
  Hero,
  HeroSpiritScaling,
  InvestmentStep,
  Item,
  ItemSection,
  LevelInfo,
  Property,
  PropertyUpgrade,
  Scale,
  Shared,
  Slot,
  SnapshotMeta,
  UpgradeType,
  Weapon,
} from "./types.ts";

// As respostas da API são grandes e pouco tipadas; tratamos como registros soltos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = Record<string, any>;

const SLOTS: Slot[] = ["weapon", "vitality", "spirit"];
const ABILITY_SLOTS = ["signature1", "signature2", "signature3", "signature4"];

/** Lê "20m", "-1.0", 25 -> { value, unit }. Retorna null se não for numérico. */
export function parseValue(raw: unknown): { value: number; unit: string } | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? { value: raw, unit: "" } : null;
  if (typeof raw !== "string") return null;
  const m = /^\s*(-?\d*\.?\d+)\s*([a-zA-Z%]*)\s*$/.exec(raw);
  if (!m) return null;
  return { value: Number.parseFloat(m[1]!), unit: m[2] ?? "" };
}

/** Remove SVG e tags HTML das descrições. */
export function stripHtml(html: unknown): string {
  if (typeof html !== "string") return "";
  return html
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/<br\s*\/?>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Aceita só URLs https; qualquer outra coisa vira null. */
function url(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("https://") ? value : null;
}

function normScale(sf: Raw | undefined): Scale | null {
  if (!sf || typeof sf !== "object") return null;
  const stats = new Set<string>();
  if (typeof sf.specific_stat_scale_type === "string") stats.add(sf.specific_stat_scale_type);
  for (const s of sf.scaling_stats ?? []) if (typeof s === "string") stats.add(s);
  const coef = typeof sf.stat_scale === "number" ? sf.stat_scale : null;
  const fn = typeof sf.class_name === "string" ? sf.class_name : null;
  if (!fn && stats.size === 0 && coef === null) return null;
  return { fn, stats: [...stats], coef };
}

const UPGRADE_TYPES: Record<string, UpgradeType> = {
  EAddToBase: "addBase",
  EAddToScale: "addScale",
  EMultiplyBase: "mulBase",
  EMultiplyScale: "mulScale",
};

function normUpgrades(raw: unknown): PropertyUpgrade[][] {
  if (!Array.isArray(raw)) return [];
  return raw.map((tier: Raw) => {
    const out: PropertyUpgrade[] = [];
    for (const pu of tier?.property_upgrades ?? []) {
      const parsed = parseValue(pu.bonus);
      if (!parsed || typeof pu.name !== "string") continue;
      out.push({
        property: pu.name,
        bonus: parsed.value,
        type: UPGRADE_TYPES[pu.upgrade_type as string] ?? "addBase",
        statFilter: typeof pu.scale_stat_filter === "string" ? pu.scale_stat_filter : null,
      });
    }
    return out;
  });
}

/**
 * Mantém só propriedades úteis: numéricas e que tenham rótulo, concedam stat,
 * tenham coeficiente de escala ou sejam alvo de um upgrade.
 */
function normProperties(raw: Raw | undefined, upgrades: PropertyUpgrade[][]): Record<string, Property> {
  const upgraded = new Set(upgrades.flat().map((u) => u.property));
  const out: Record<string, Property> = {};
  for (const [key, p] of Object.entries((raw ?? {}) as Record<string, Raw>)) {
    if (!p || typeof p !== "object") continue;
    const parsed = parseValue(p.value);
    if (!parsed) continue;
    const scale = normScale(p.scale_function);
    const isDisabled = p.disable_value !== undefined && String(p.value) === String(p.disable_value);
    const isUpgraded = upgraded.has(key);
    if (isDisabled && !isUpgraded) continue;
    const provides =
      typeof p.provided_property_type === "string" && p.provided_property_type !== "MODIFIER_VALUE_INVALID"
        ? p.provided_property_type
        : null;
    const label = typeof p.label === "string" && p.label ? p.label : null;
    const meaningful = label !== null || provides !== null || (scale?.coef ?? null) !== null || isUpgraded;
    if (!meaningful) continue;
    if (parsed.value === 0 && !isUpgraded && !provides && (scale?.coef ?? null) === null) continue;
    out[key] = {
      value: parsed.value,
      unit: parsed.unit || (typeof p.postfix === "string" ? p.postfix.trim() : ""),
      label,
      provides,
      flags: Array.isArray(p.usage_flags) ? p.usage_flags : [],
      conditional: typeof p.conditional === "string" ? p.conditional : null,
      scale,
    };
  }
  return out;
}

function normWeapon(className: string, wi: Raw): Weapon {
  const clip = Number(wi.clip_size ?? 0);
  const sps = Number(wi.shots_per_second ?? (wi.cycle_time ? 1 / wi.cycle_time : 0));
  const spsReload = Number(wi.shots_per_second_with_reload ?? 0);
  const single = wi.reload_single_bullets === true;
  let reloadTime: number;
  if (single) {
    // Recarga bala a bala: atraso inicial + uma recarga por bala do pente.
    reloadTime = Number(wi.reload_single_bullets_initial_delay ?? 0) + clip * Number(wi.reload_duration ?? 0);
  } else if (clip > 0 && sps > 0 && spsReload > 0) {
    // A API já embute o atraso extra de recarga em shots_per_second_with_reload;
    // derivamos o tempo total a partir dele em vez de assumir só reload_duration.
    reloadTime = clip / spsReload - clip / sps;
  } else {
    reloadTime = Number(wi.reload_duration ?? 0);
  }
  return {
    className,
    bulletDamage: Number(wi.bullet_damage ?? 0),
    bullets: Number(wi.bullets ?? 1),
    shotsPerSecond: sps,
    clipSize: clip,
    reloadTime,
    reloadSingleBullets: single,
    headshotMultiplier: Number(wi.crit_bonus_start ?? 1),
    falloff: {
      startRange: Number(wi.damage_falloff_start_range ?? 0),
      endRange: Number(wi.damage_falloff_end_range ?? 0),
      startScale: Number(wi.damage_falloff_start_scale ?? 1),
      endScale: Number(wi.damage_falloff_end_scale ?? 1),
    },
  };
}

function numericMap(raw: Raw | undefined, pick: (v: unknown) => unknown = (v) => v): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    const n = pick(v);
    if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

function normHero(h: Raw, byClass: Map<string, Raw>): Hero | null {
  const weaponClass = h.items?.weapon_primary;
  const weaponRaw = typeof weaponClass === "string" ? byClass.get(weaponClass) : undefined;
  if (!weaponRaw?.weapon_info) return null;
  const abilities = ABILITY_SLOTS.map((s) => h.items?.[s]).filter((c): c is string => typeof c === "string");
  const scaling: HeroSpiritScaling[] = [];
  for (const [stat, v] of Object.entries((h.scaling_stats ?? {}) as Record<string, Raw>)) {
    if (typeof v?.scale === "number") scaling.push({ stat, source: String(v.scaling_stat ?? ""), scale: v.scale });
  }
  return {
    id: h.id,
    className: h.class_name,
    name: h.name,
    heroType: typeof h.hero_type === "string" ? h.hero_type : null,
    inDevelopment: h.in_development === true,
    image: url(h.images?.icon_image_small_webp ?? h.images?.icon_image_small),
    start: numericMap(h.starting_stats, (v) => (v as Raw | null)?.value),
    perBoon: numericMap(h.standard_level_up_upgrades),
    scaling,
    weapon: normWeapon(weaponClass, weaponRaw.weapon_info),
    abilities,
  };
}

function normAbility(a: Raw, heroId: number, slot: number): Ability {
  const upgrades = normUpgrades(a.upgrades);
  return {
    id: a.id,
    className: a.class_name,
    name: a.name,
    heroId,
    slot,
    abilityType: String(a.ability_type ?? ""),
    image: url(a.image_webp ?? a.image),
    properties: normProperties(a.properties, upgrades),
    upgrades,
    text: stripHtml(a.description?.desc),
  };
}

function normSections(raw: unknown): ItemSection[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s: Raw) => {
    const attrs: Raw[] = Array.isArray(s.section_attributes) ? s.section_attributes : [];
    return {
      type: typeof s.section_type === "string" ? s.section_type : "passive",
      text: attrs.map((a) => stripHtml(a.loc_string)).filter(Boolean).join(" "),
      properties: attrs.flatMap((a) => [...(a.properties ?? []), ...(a.elevated_properties ?? [])]),
      important: attrs.flatMap((a) => a.important_properties ?? []),
    };
  });
}

const CONDITIONAL_FLAGS = new Set(["ConditionallyApplied", "ConditionallyEnemyApplied"]);

function normItem(it: Raw): Item {
  const apiUpgrades = normUpgrades(it.upgrades);
  const properties = normProperties(it.properties, apiUpgrades);
  const sections = normSections(it.tooltip_sections);
  const innateKeys = new Set(sections.filter((s) => s.type === "innate").flatMap((s) => s.properties));
  const innate: Record<string, number> = {};
  const conditional: string[] = [];
  for (const [key, p] of Object.entries(properties)) {
    if (!p.provides || p.value === 0) continue;
    const isConditional = p.conditional !== null || p.flags.some((f) => CONDITIONAL_FLAGS.has(f));
    if (innateKeys.has(key) && !isConditional) {
      innate[p.provides] = (innate[p.provides] ?? 0) + p.value;
    } else {
      conditional.push(key);
    }
  }
  return {
    id: it.id,
    className: it.class_name,
    name: it.name,
    slot: it.item_slot_type,
    tier: it.item_tier,
    cost: it.cost,
    isActive: it.is_active_item === true,
    activation: typeof it.activation === "string" ? it.activation : null,
    image: url(it.shop_image_webp ?? it.shop_image ?? it.image_webp ?? it.image),
    components: Array.isArray(it.component_items) ? it.component_items : [],
    innate,
    conditional,
    properties,
    apiUpgrades,
    sections,
    text: stripHtml(it.description?.desc),
  };
}

function normShared(hero: Raw, generic: Raw): Shared {
  const levels: LevelInfo[] = Object.entries((hero.level_info ?? {}) as Record<string, Raw>)
    .map(([lvl, v]) => {
      const grants: LevelInfo["grants"] = [];
      for (const c of v.bonus_currencies ?? []) {
        if (c === "EAbilityPoints") grants.push("abilityPoint");
        if (c === "EAbilityUnlocks") grants.push("abilityUnlock");
      }
      return { level: Number(lvl), souls: Number(v.required_gold ?? 0), grants };
    })
    .sort((a, b) => a.level - b.level);
  const investment = {} as Record<Slot, InvestmentStep[]>;
  for (const slot of SLOTS) {
    investment[slot] = ((hero.cost_bonuses?.[slot] ?? []) as Raw[])
      .map((s) => ({ souls: Number(s.gold_threshold), bonus: Number(s.bonus) }))
      .sort((a, b) => a.souls - b.souls);
  }
  const arr = (v: unknown) => (Array.isArray(v) && v.every((n) => typeof n === "number") ? (v as number[]) : null);
  return {
    levels,
    investment,
    tierPrices: arr(generic.item_price_per_tier) ?? [],
    trooperSoulShare: arr(generic.trooper_kill_gold_share_frac),
    heroKillSoulShare: arr(generic.hero_kill_gold_share_frac),
  };
}

export interface RawSnapshot {
  heroes: Raw[];
  items: Raw[];
  generic: Raw;
  steamInfo: Raw;
}

export function normalize(raw: RawSnapshot, fetchedAt: string): GameData {
  const byClass = new Map<string, Raw>();
  for (const it of raw.items) if (typeof it.class_name === "string") byClass.set(it.class_name, it);

  const activeHeroes = raw.heroes.filter((h) => h.player_selectable === true && h.disabled !== true);
  if (activeHeroes.length === 0) throw new Error("Nenhum herói jogável na resposta da API.");

  // Tabelas de nível e de investimento são iguais para todos os heróis; conferimos isso.
  const first = activeHeroes[0]!;
  const sig = (h: Raw) => JSON.stringify([h.level_info, h.cost_bonuses]);
  const divergent = activeHeroes.filter((h) => sig(h) !== sig(first)).map((h) => h.name);
  if (divergent.length > 0) {
    throw new Error(`Tabelas de nível/investimento diferem por herói (${divergent.join(", ")}); o modelo compartilhado precisa ser revisto.`);
  }

  const heroes: Hero[] = [];
  const abilities: Ability[] = [];
  for (const h of activeHeroes) {
    const hero = normHero(h, byClass);
    if (!hero) continue;
    heroes.push(hero);
    hero.abilities.forEach((cls, i) => {
      const a = byClass.get(cls);
      if (a) abilities.push(normAbility(a, hero.id, i + 1));
    });
  }
  heroes.sort((a, b) => a.name.localeCompare(b.name));

  const items = raw.items
    .filter((i) => i.type === "upgrade" && i.shopable === true && i.disabled !== true)
    .filter((i) => SLOTS.includes(i.item_slot_type))
    .map(normItem)
    .sort((a, b) => a.slot.localeCompare(b.slot) || a.tier - b.tier || a.name.localeCompare(b.name));

  const meta: SnapshotMeta = {
    clientVersion: Number(raw.steamInfo.client_version ?? 0),
    versionDate: typeof raw.steamInfo.version_date === "string" ? raw.steamInfo.version_date : null,
    fetchedAt,
    source: "https://api.deadlock-api.com",
    counts: { heroes: heroes.length, abilities: abilities.length, items: items.length },
  };
  return { meta, shared: normShared(first, raw.generic), heroes, abilities, items };
}
