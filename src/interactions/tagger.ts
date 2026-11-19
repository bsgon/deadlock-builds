/**
 * Etiqueta itens, habilidades e armas a partir dos dados do snapshot.
 * Três fontes, em ordem de confiança: tipo de bônus (MODIFIER_VALUE_*),
 * nome/escala das propriedades e, por último, palavras-chave do texto.
 * Erros da etiquetagem automática são corrigidos em overrides.ts.
 */
import type { Ability, GameData, Hero, Item, Property, PropertyUpgrade } from "../data/types.ts";
import { OVERRIDES } from "./overrides.ts";
import type { Damage, Debuff, Facets, Node, Stat, Trigger, When } from "./tags.ts";

interface ProvideRule {
  /** Recurso concedido quando o valor é positivo. */
  gives?: Stat;
  /** Debuff aplicado quando o valor é positivo. */
  applies?: Debuff;
  /**
   * Debuff aplicado quando o valor é negativo (ex.: cura recebida -33%).
   * Só para tipos em que negativo significa efeito no inimigo; penalidades
   * no próprio usuário (velocidade, spirit) não viram debuff.
   */
  negative?: Debuff;
}

const PROVIDES: Record<string, ProvideRule> = {
  TECH_POWER: { gives: "spiritPower" },
  TECH_POWER_PERCENT: { gives: "spiritPower" },
  WEAPON_DAMAGE_INCREASE: { gives: "weaponDamage" },
  CLOSE_RANGE_WEAPON_DAMAGE_INCREASE: { gives: "weaponDamage" },
  LONG_RANGE_BULLET_DAMAGE_INCREASE: { gives: "weaponDamage" },
  FLAT_BULLET_DAMAGE_POST_SCALE: { gives: "weaponDamage" },
  FIRE_RATE: { gives: "fireRate" },
  AMMO_CLIP_SIZE: { gives: "ammo" },
  AMMO_CLIP_SIZE_PERCENT: { gives: "ammo" },
  RELOAD_SPEED: { gives: "reload" },
  COOLDOWN_REDUCTION_PERCENTAGE: { gives: "cooldown" },
  ULTIMATE_COOLDOWN_REDUCTION_PERCENTAGE: { gives: "cooldown" },
  COOLDOWN_BETWEEN_CHARGE_REDUCTION_PERCENTAGE: { gives: "cooldown" },
  ITEM_COOLDOWN_REDUCTION_PERCENTAGE: { gives: "itemCooldown" },
  BONUS_ABILITY_DURATION_PERCENTAGE: { gives: "duration" },
  TECH_RANGE_PERCENT: { gives: "range" },
  TECH_RADIUS_PERCENT: { gives: "range" },
  BONUS_ABILITY_CHARGES: { gives: "charges" },
  ENABLE_CHARGES: { gives: "charges" },
  HEALTH_MAX: { gives: "health" },
  HEALTH_MAX_PERCENT: { gives: "health" },
  BASE_HEALTH_PERCENT: { gives: "health" },
  BARRIER_HEALTH: { gives: "barrier" },
  BULLET_ARMOR_DAMAGE_RESIST: { gives: "bulletResist", negative: "bulletShred" },
  BULLET_EVASION: { gives: "bulletResist" },
  MELEE_RESIST: { gives: "bulletResist" },
  TECH_RESIST: { gives: "spiritResist", negative: "spiritShred" },
  MOVEMENT_SPEED_MAX: { gives: "moveSpeed" },
  MOVEMENT_SPEED_MAX_PERCENT: { gives: "moveSpeed" },
  SPRINT_SPEED_BONUS: { gives: "moveSpeed" },
  BULLET_LIFESTEAL: { gives: "bulletLifesteal" },
  TECH_LIFESTEAL: { gives: "spiritLifesteal" },
  TECH_DAMAGE_TAKEN_HEALS_ATTACKER: { gives: "spiritLifesteal" },
  HEALTH_REGEN_PER_SECOND: { gives: "regen" },
  EXTERNAL_HEALTH_REGEN_PER_SECOND: { gives: "regen" },
  OUT_OF_COMBAT_HEALTH_REGEN: { gives: "regen" },
  HEAL_AMP_CAST_PERCENT: { gives: "healAmp" },
  HEAL_AMP_RECEIVE_PERCENT: { gives: "healAmp", negative: "antiHeal" },
  HEAL_AMP_REGEN_PERCENT: { gives: "healAmp", negative: "antiHeal" },
  MELEE_DAMAGE_INCREASE: { gives: "melee" },
  MELEE_DAMAGE_MULTIPLIER: { gives: "melee" },
  STAMINA: { gives: "stamina" },
  STAMINA_REGEN_PER_SECOND_PERCENTAGE: { gives: "stamina" },
  ALL_DAMAGE_MULTIPLIER: { gives: "damageAmp" },
  TECH_DAMAGE_MULTIPLIER: { gives: "damageAmp" },
  OUTGOING_DAMAGE_PERCENTAGE_CHANGE: { gives: "damageAmp" },
  // Estes só existem como debuff no inimigo, com qualquer sinal.
  TECH_RESIST_REDUCTION: { applies: "spiritShred", negative: "spiritShred" },
  BULLET_AND_MELEE_RESIST_REDUCTION: { applies: "bulletShred", negative: "bulletShred" },
  MELEE_RESIST_REDUCTION: { applies: "bulletShred", negative: "bulletShred" },
  MOVEMENT_SPEED_SLOW_PERCENT: { applies: "slow", negative: "slow" },
  FIRE_RATE_SLOW: { applies: "fireRateSlow", negative: "fireRateSlow" },
  ALL_DAMAGE_TAKEN_INCREASE: { applies: "damageTaken" },
  BULLET_DAMAGE_TAKEN_INCREASE: { applies: "damageTaken" },
};

/** Tipos de bônus (sem o prefixo MODIFIER_VALUE_) que a etiquetagem reconhece. */
export const KNOWN_PROVIDES: ReadonlySet<string> = new Set(Object.keys(PROVIDES));

/**
 * Tipos de bônus vistos e deixados de fora de propósito: mobilidade fina,
 * efeitos contra NPCs e detalhes que não mudam dano, vida ou sinergia.
 * A rotina de patch só avisa sobre tipos que não estão aqui nem em PROVIDES.
 */
export const IGNORED_PROVIDES: ReadonlySet<string> = new Set([
  "MOVEMENT_GROUND_DASH_REDUCTION_PERCENT",
  "STATUS_RESISTANCE",
  "BONUS_BULLET_SPEED_PERCENT",
  "AIR_CONTROL_PERCENT",
  "AIR_CONTROL_ACCEL_PERCENT",
  "MOVEMENT_SPEED_WHILE_SHOOTING_PENALTY_REDUCTION_PERCENT",
  "MOVEMENT_SPEED_WHILE_ZOOMED_PENALTY_REDUCTION_PERCENT",
  "MOVE_SPEED_LIMIT",
  "MOVEMENT_SLOW_RESISTANCE",
  "MOVEMENT_SLIDE_DISTANCE_SCALE",
  "MOVEMENT_SLIDE_TURN_SCALE",
  "MELEE_TRAVEL_DISTANCE_PERCENTAGE",
  "WEAPON_DAMAGE_TO_NPC_INCREASE",
  "BULLET_RESIST_NON_HERO",
  "BONUS_WEAPON_DAMAGE_CLOSE_RANGE_MAX_RANGE",
  "BONUS_BULLET_DAMAGE_LONG_RANGE_MIN_RANGE",
  "BONUS_ATTACK_RANGE_PERCENT",
  "ANIMATION_FRAME_SKIP_RATE",
  "PARRY_COOLDOWN_REDUCTION_FIXED",
  "GRAVITY_SCALE",
  "AIR_MOVE_DISTANCE_INCREASE_PERCENT",
  "RESPAWN_TIME_PERCENTAGE",
  "ZOOM_INCREASE_PERCENT",
]);

/** Propriedades cujo nome indica dano causado. */
const DAMAGE_KEY = /Damage|DPS|LifeDrainPerSecond/;
const NOT_DEALT = /Taken|Received|Incoming|Reflected|Threshold|Window|Reduction|Resist|Penalty|SelfDamage|Scale$|Given|BonusDamagePercent|MinChargeDamagePercent/;
const DOT_KEY = /DPS|PerSecond|Burn|Bleed|Tick|Pulse/;
const PERCENT_HEALTH_KEY = /HealthPercent|MaxHealth|MaxHP|CurrentHealth/;
/** Em itens, só estes nomes contam como dano de spirit sem precisar de escala. */
const ITEM_SPIRIT_KEY = /Magic|Spirit|^(Damage|DPS|ImpactDamage|ExplosionDamage|DamagePerChain|DamagePulseAmount)$/;
const HEAL_KEY = /Heal(?!thTo|th(?!Regen))|Regen|Lifesteal|LifeDrain|HealthSteal/;

const WANT_BY_SCALE_STAT: Record<string, Stat> = {
  ETechCooldown: "cooldown",
  ETechCooldownBetweenChargeUses: "cooldown",
  ETechDuration: "duration",
  EChannelDuration: "duration",
  ETechRange: "range",
  ETechRadius: "range",
  EHealingOutput: "healAmp",
  ELightMeleeDamage: "melee",
  EHeavyMeleeDamage: "melee",
  EWeaponPower: "weaponDamage",
  EBaseWeaponDamageIncrease: "weaponDamage",
  EWeaponDamageScale: "weaponDamage",
  EBulletDamage: "weaponDamage",
};
const COEF_POWER_STATS = new Set(["ELevelUpBoons", "ELightMeleeDamage", "EHeavyMeleeDamage", "EWeaponPower", "EBaseWeaponDamageIncrease", "EWeaponDamageScale", "EBulletDamage", "EStatsCount"]);

interface TextRule<T> {
  tag: T;
  match: RegExp;
  /** Se casar, a regra não se aplica (evita falsos positivos conhecidos). */
  unless?: RegExp;
}

const TRIGGER_TEXT: TextRule<Trigger>[] = [
  { tag: "imbue", match: /\bimbue/i },
  { tag: "onBullet", match: /your (next )?(bullets?|attacks?)|bullets? hits? a hero|shooting heroes|continuously fire|dealing (significant )?weapon damage|your weapon fire/i },
  { tag: "onHeadshot", match: /headshot/i },
  { tag: "onMelee", match: /melee attack|heavy melee|light melee|your melee/i },
  { tag: "onParry", match: /\bparry/i, unless: /pierces through parry/i },
  { tag: "onSpiritDamage", match: /(dealing|when you deal|takes|your) (significant )?spirit damage|dealing significant damage/i },
  { tag: "onAbilityHit", match: /abilit(y|ies) deal|dealing damage with that ability|when the ability deals damage|damage from your ultimate/i },
  { tag: "onAbilityUse", match: /cast an ability|ability you use|that ability is used|casting an ultimate|imbued ability charges/i },
  { tag: "onUltimate", match: /(?<!non-)ultimate/i },
  { tag: "onHeal", match: /applying heal/i },
  { tag: "onKill", match: /\bkill|assist\b/i, unless: /non-lethal/i },
  { tag: "onMovement", match: /dash-jump|when sliding|stamina use\b|when airborne|air dash/i, unless: /prevents stamina usage/i },
  { tag: "highHealth", match: /above \d+% health/i, unless: /enemies above/i },
  { tag: "lowHealth", match: /below \d+% health/i },
  { tag: "closeRange", match: /close range/i },
  { tag: "longRange", match: /beyond a minimum distance/i },
  { tag: "takingDamage", match: /you take|take (significant|sustained|heavy)|taking heavy|shoot you|attacker who damages you|would take lethal/i },
];

const DEBUFF_TEXT: TextRule<Debuff>[] = [
  { tag: "silence", match: /silenc/i, unless: /but silences you|immune to stun, silence|stunned, chained|stun, chain/i },
  { tag: "stun", match: /\bstun|freez|immobiliz/i, unless: /non-stun|immune to stun|stunned, chained|stun, chain|while stunned|when you are stunned|movement lock/i },
  { tag: "disarm", match: /disarm/i, unless: /immune to/i },
  { tag: "slow", match: /\bslow/i, unless: /slow resist|immune to slows|fire rate slowed|drop down faster/i },
  { tag: "antiHeal", match: /incoming healing|healing reduction|reduced healing|prevents .*healing/i, unless: /enemy applied healing reduction|you deal reduced damage/i },
  { tag: "spiritShred", match: /(reduc\w+|steals?) [^.]*spirit resist/i },
  { tag: "bulletShred", match: /(reduc\w+|steals?) [^.]*bullet resist|bullet resist debuff|ignoring their bullet resist|reduced bullet resist/i },
  { tag: "fireRateSlow", match: /reduc\w+ [^.]*fire rate|fire rate slowed/i },
  { tag: "weaken", match: /(reduc\w+) [^.]*(outgoing|damage output|spirit power)|steals? [^.]*spirit power/i, unless: /your own damage output/i },
];

function emptyFacets(): Facets {
  return { gives: {}, applies: [], deals: [], triggers: [], wants: {} };
}

function add<T>(list: T[], value: T): void {
  if (!list.includes(value)) list.push(value);
}

function give(facets: Facets, stat: Stat, when: When): void {
  if (facets.gives[stat] !== "always") facets.gives[stat] = when;
}

function want(facets: Facets, stat: Stat, strength: number): void {
  facets.wants[stat] = Math.max(facets.wants[stat] ?? 0, strength);
}

/** Valor que decide o sinal: o base ou, se for zero, o primeiro bônus de upgrade. */
function effectiveValue(key: string, prop: Property, upgrades: PropertyUpgrade[][]): number {
  if (prop.value !== 0) return prop.value;
  for (const tier of upgrades) for (const up of tier) if (up.property === key && up.bonus !== 0) return up.bonus;
  return 0;
}

function tagProperties(
  facets: Facets,
  properties: Record<string, Property>,
  upgrades: PropertyUpgrade[][],
  isAlways: (key: string, prop: Property) => boolean,
  strictDamage: boolean,
): void {
  let spiritCoef = 0;
  for (const [key, prop] of Object.entries(properties)) {
    const value = effectiveValue(key, prop, upgrades);
    const coef = prop.scale?.coef ?? null;
    if (value === 0 && coef === null) continue;

    if (prop.provides) {
      const rule = PROVIDES[prop.provides.replace("MODIFIER_VALUE_", "")];
      if (rule) {
        if (value < 0 && rule.negative) add(facets.applies, rule.negative);
        else if (rule.applies) add(facets.applies, rule.applies);
        else if (rule.gives && value > 0) give(facets, rule.gives, isAlways(key, prop) ? "always" : "conditional");
      }
    }

    if (DAMAGE_KEY.test(key) && !NOT_DEALT.test(key) && !prop.provides && value > 0) {
      if (/Melee/.test(key)) add(facets.deals, "melee");
      else if (/Weapon|Bullet(?!s?BonusMagic)|HeadShot|Headshot/.test(key) && !/Magic/.test(key)) add(facets.deals, "weapon");
      else if (!strictDamage || coef !== null || ITEM_SPIRIT_KEY.test(key)) add(facets.deals, DOT_KEY.test(key) ? "spiritDot" : "spirit");
      if (/PerBullet|BulletsBonus/.test(key)) add(facets.triggers, "onBullet");
    }
    if (PERCENT_HEALTH_KEY.test(key) && /Damage|DPS|Dot/.test(key) && value > 0) add(facets.deals, "percentHealth");
    if (HEAL_KEY.test(key) && !prop.provides && value > 0) give(facets, "healing", "conditional");

    if (prop.scale && value !== 0) {
      for (const stat of prop.scale.stats) {
        const wanted = WANT_BY_SCALE_STAT[stat];
        if (wanted) want(facets, wanted, 1);
      }
      const byBoons = prop.scale.fn?.includes("boon") ?? false;
      if (coef !== null && coef > 0 && !byBoons && !prop.scale.stats.some((s) => COEF_POWER_STATS.has(s))) spiritCoef += coef;
    }
  }
  if (spiritCoef > 0) want(facets, "spiritPower", Math.min(3, Math.max(0.3, spiritCoef)));
  if ((properties.AbilityCharges?.value ?? 0) >= 1) want(facets, "charges", 1);
}

function tagText(facets: Facets, text: string): void {
  for (const rule of TRIGGER_TEXT) if (rule.match.test(text) && !rule.unless?.test(text)) add(facets.triggers, rule.tag);
  for (const rule of DEBUFF_TEXT) if (rule.match.test(text) && !rule.unless?.test(text)) add(facets.applies, rule.tag);
  if (/(?<!you )\bdeals? (bonus |extra |additional |increasing )?spirit damage|spirit damage (over time|per second)|deals (impact )?damage/i.test(text)) {
    add(facets.deals, /over time|per second|periodically/i.test(text) ? "spiritDot" : "spirit");
  }
  if (/bonus weapon damage|additional weapon damage|increased damage and velocity/i.test(text)) add(facets.deals, "weapon");
  if (/\bheals? (you|yourself|a target|nearby)|\bheal yourself|heal and gain/i.test(text)) give(facets, "healing", "conditional");
}

/** Consequências das etiquetas: do que um efeito disparado precisa para render. */
function deriveWants(facets: Facets): void {
  if (facets.triggers.includes("onBullet")) {
    want(facets, "fireRate", 1);
    want(facets, "ammo", 0.5);
  }
  if (facets.triggers.includes("onMelee")) want(facets, "melee", 0.5);
  if (facets.triggers.includes("onUltimate") || facets.triggers.includes("onAbilityUse")) want(facets, "cooldown", 0.7);
  if (facets.gives.healing) want(facets, "healAmp", 0.7);
  if (facets.triggers.includes("active")) want(facets, "itemCooldown", 0.8);
}

function applyOverride(node: Node): Node {
  const o = OVERRIDES[node.name];
  if (!o) return node;
  for (const tag of o.remove?.applies ?? []) node.applies = node.applies.filter((t) => t !== tag);
  for (const tag of o.remove?.deals ?? []) node.deals = node.deals.filter((t) => t !== tag);
  for (const tag of o.remove?.triggers ?? []) node.triggers = node.triggers.filter((t) => t !== tag);
  for (const stat of o.remove?.gives ?? []) delete node.gives[stat];
  for (const stat of o.remove?.wants ?? []) delete node.wants[stat];
  for (const tag of o.add?.applies ?? []) add(node.applies, tag);
  for (const tag of o.add?.deals ?? []) add(node.deals, tag);
  for (const tag of o.add?.triggers ?? []) add(node.triggers, tag);
  Object.assign(node.gives, o.add?.gives ?? {});
  Object.assign(node.wants, o.add?.wants ?? {});
  return node;
}

export function tagItem(item: Item): Node {
  const facets = emptyFacets();
  const innateTypes = new Set(Object.keys(item.innate));
  const conditional = new Set(item.conditional);
  tagProperties(facets, item.properties, [], (key, prop) => !conditional.has(key) && prop.provides !== null && innateTypes.has(prop.provides), true);
  tagText(facets, [item.text, ...item.sections.filter((s) => s.type !== "innate").map((s) => s.text)].join(" "));
  if (item.isActive) add(facets.triggers, "active");
  deriveWants(facets);
  return applyOverride({ id: item.className, kind: "item", name: item.name, heroId: null, slot: item.slot, ...facets });
}

export function tagAbility(ability: Ability): Node {
  const facets = emptyFacets();
  tagProperties(facets, ability.properties, ability.upgrades, () => false, false);
  // O texto de habilidade só é usado para gatilhos ligados à arma; o resto vem das propriedades.
  if (/your bullets|your weapon|while shooting|each bullet|weapon hits|shooting a target|bullet hit/i.test(ability.text)) add(facets.triggers, "onBullet");
  if (/increases the damage they take|take increased damage|takes? more damage/i.test(ability.text)) add(facets.applies, "damageTaken");
  if (/headshot/i.test(ability.text)) add(facets.triggers, "onHeadshot");
  // Recompensa corpo a corpo pelo texto ou por um campo de melee, inclusive vindo de
  // upgrade (ex.: o 2º upgrade de Infernal Resilience, do Abrams, dá lifesteal no melee).
  const upgradeKeys = ability.upgrades.flat().map((u) => u.property);
  const meleeKey = [...Object.keys(ability.properties), ...upgradeKeys].some((k) => /Melee/.test(k) && !/Resist|Distance|Range/.test(k));
  if (/melee/i.test(ability.text) || meleeKey) add(facets.triggers, "onMelee");
  if (ability.slot === 4) add(facets.triggers, "onUltimate");
  if (ability.properties.AbilityCooldown && ability.properties.AbilityCooldown.value > 0) want(facets, "cooldown", 1);
  deriveWants(facets);
  return applyOverride({ id: ability.className, kind: "ability", name: ability.name, heroId: ability.heroId, ...facets });
}

const HERO_SCALING_WANT: Record<string, Stat> = {
  EBulletDamage: "weaponDamage",
  EClipSize: "ammo",
  EFireRate: "fireRate",
  ERoundsPerSecond: "fireRate",
  EMaxMoveSpeed: "moveSpeed",
  ESprintSpeed: "moveSpeed",
  ETechArmorDamageReduction: "spiritResist",
  EBulletArmorDamageReduction: "bulletResist",
  EBaseHealthRegen: "regen",
  EHeavyMeleeDamage: "melee",
};

/** Nó da arma do herói: causa dano de arma e aproveita tudo que melhora tiros. */
export function tagWeapon(hero: Hero): Node {
  const facets = emptyFacets();
  add(facets.deals, "weapon");
  add(facets.triggers, "onBullet");
  want(facets, "weaponDamage", 1);
  want(facets, "fireRate", 1);
  want(facets, "ammo", 0.7);
  want(facets, "reload", 0.5);
  // Escalas próprias do herói: Spirit Power vira outro recurso (ex.: pente do Haze).
  for (const s of hero.scaling) {
    const converted = HERO_SCALING_WANT[s.stat];
    if (converted) {
      want(facets, "spiritPower", 1);
      give(facets, converted, "conditional");
    }
  }
  return {
    id: `weapon:${hero.className}`,
    kind: "weapon",
    name: `Arma de ${hero.name}`,
    heroId: hero.id,
    hitsPerSecond: hero.weapon.shotsPerSecond * hero.weapon.bullets,
    ...facets,
  };
}

export interface TaggedData {
  items: Node[];
  /** Nós do kit de cada herói (4 habilidades + arma), por id do herói. */
  kits: Map<number, Node[]>;
}

export function tagAll(data: GameData): TaggedData {
  const kits = new Map<number, Node[]>();
  for (const hero of data.heroes) {
    const abilities = data.abilities.filter((a) => a.heroId === hero.id).sort((a, b) => a.slot - b.slot).map(tagAbility);
    kits.set(hero.id, [...abilities, tagWeapon(hero)]);
  }
  return { items: data.items.map(tagItem), kits };
}
