/**
 * Métricas de uma build por objetivo (dano, tank, sustain).
 *
 * São índices para comparar builds do MESMO herói, não previsões de combate:
 * dano de habilidade é o de uma luta de `fightSeconds` que começa com tudo
 * pronto, cada habilidade acertando o alvo; dano de itens é estimado por
 * frequência de proc (ativos também pela luta).
 */
import type { Item } from "../data/types.ts";
import { resolveProperties, type BuildResult, type ResolvedProperty } from "../engine/index.ts";
import { itemUptime } from "../engine/conditional.ts";
import { contextId, memoByObject } from "../engine/memo.ts";
import { controlSources, type ControlSource } from "./control.ts";
import { effectiveHealth } from "./defense.ts";
import { antiHealDps } from "./antiheal.ts";
import { amplification } from "./amplify.ts";
import { playUtility, setScenarioMix, type PlanId, type ScenarioId } from "../combat/value.ts";
import type { FightProfile } from "../meta/fights.ts";

export interface Metrics {
  /** DPS de arma pelo tempo atirando (limitado pela recarga), já com a redução de resistência do alvo. */
  weaponDps: number;
  /** Índice de dano por segundo das habilidades. */
  abilityDps: number;
  /** Dano por segundo estimado dos efeitos de itens (procs e ativos). */
  itemDps: number;
  /** Dano de golpes corpo a corpo, pelo quanto o herói usa melee. */
  meleeDps: number;
  /** Cura que o inimigo deixa de receber (anti-cura), contada como dano equivalente. */
  antiHealDps: number;
  /** Dano a mais por vulnerabilidade no alvo (Malice, Napalm, Escalating Exposure...), já somado ao resto. */
  ampDps: number;
  /** Dano físico: arma + efeitos de item disparados por bala + corpo a corpo. */
  gunDps: number;
  /** Dano de quem joga por habilidades: habilidades + efeitos de item que não dependem de atirar. */
  spiritDps: number;
  /** Arma + habilidades + itens + corpo a corpo + cura negada ao inimigo. */
  totalDps: number;
  /** Vida efetiva média contra bala e spirit. */
  ehp: number;
  /** Cura por segundo: regeneração + lifesteal sobre o dano causado. */
  sustain: number;
  /**
   * Vida que o herói tem para gastar numa luta: vida efetiva mais a cura ao longo da
   * duração medida da luta. Junta tanque e sustain na mesma unidade.
   */
  fightHp: number;
  /** Segundos de controle por minuto (stun = 1, slow pela força), de habilidades e itens. */
  control: number;
  /**
   * Valor das jogadas simuladas (U do plano em `MetricOptions.plan`): alvos atingidos,
   * controle útil, dano aproveitável, sobrevivência e frequência do combo. 0 sem plano.
   */
  play: number;
}

export interface MetricOptions {
  /** Fração do tempo em que efeitos condicionais valem (mesmo valor usado no motor). */
  uptime: number;
  /**
   * Fração do tempo de luta em que o herói está atirando. A recarga só custa
   * dano quando não cabe no tempo restante, então munição extra vale pouco
   * para quem já consegue recarregar nas pausas.
   */
  shooting: number;
  /** Resistências do alvo de referência, em %. */
  targetBulletResist: number;
  targetSpiritResist: number;
  /** Vida máxima do alvo de referência, para efeitos em % da vida (ex.: Toxic Bullets). */
  targetHealth: number;
  /** Plano de jogo das jogadas simuladas (métrica `play`); sem plano, `play` = 0. */
  plan?: PlanId;
  /** Tipos de luta considerados nas jogadas (padrão: a mistura do plano, cenário assumido). */
  fights?: ScenarioId[];
  /**
   * Duração da luta, em segundos, para habilidades e itens com cooldown. A luta começa
   * com tudo pronto: uma ultimate de 150 s rende o dano dela nesses segundos, não
   * dividido pelos 150 s (o que a deixava valendo quase nada perto da arma).
   */
  fightSeconds?: number;
}

/** Duração da luta sem dados de partidas, em segundos. */
export const FALLBACK_FIGHT_SECONDS = 10;
let defaultFightSeconds = FALLBACK_FIGHT_SECONDS;
/** Duração da luta em uso: a mediana medida nas partidas, quando o snapshot tem `fights.json`. */
export const fightSeconds = () => defaultFightSeconds;

/**
 * Aplica o perfil de lutas medido nas partidas a todo o cálculo: duração da luta
 * (mediana do tempo até a morte) e mistura de tipos de luta das jogadas.
 */
export function applyFightProfile(profile: FightProfile | undefined): void {
  defaultFightSeconds = profile?.timeToKill.median || FALLBACK_FIGHT_SECONDS;
  setScenarioMix(profile?.mix);
}

/**
 * Dano por segundo, numa luta de `fight` segundos que começa com o efeito pronto,
 * de algo com rajada `burst` e dano contínuo `dot` por `duration` segundos a cada uso.
 */
export function fightDamagePerSecond(burst: number, dot: number, duration: number, cooldown: number, fight = fightSeconds()): number {
  const cd = Math.max(1, cooldown);
  const uses = 1 + Math.floor(Math.max(0, fight - 1e-6) / cd);
  return (uses * burst + dot * Math.min(fight, uses * Math.min(duration, cd))) / fight;
}

export const DEFAULT_METRIC_OPTIONS: MetricOptions = { uptime: 0.5, shooting: 0.5, targetBulletResist: 0, targetSpiritResist: 0, targetHealth: 2500 };

/** Valor da vida efetiva acima do piso: 10% a mais vale ~(1,1^x - 1) de pontuação. */
export const DEFENSE_ABOVE_FLOOR = 0.45;

const DAMAGE_KEY = /Damage|DPS|LifeDrainPerSecond/;
const NOT_DEALT = /Taken|Received|Incoming|Reflected|Threshold|Window|Reduction|Resist|Penalty|SelfDamage|Scale$|Given|Percent|Pct|Weapon|Bullet(?!s?BonusMagic)|Melee|HeadShot|Headshot|Health|MaxHP|Range$|Radius$|Increase|DPSMax|Duration$/;
const DOT_KEY = /DPS|PerSecond/;
/** Dano que o próprio nome diz ser aplicado a cada bala. */
const BULLET_DAMAGE_KEY = /PerBullet|BulletsBonus/;
const DURATION_KEYS = ["AbilityDuration", "BurnDuration", "DebuffDuration", "AbilityChannelTime", "GroundFlameDuration"];
const DEFAULT_DOT_DURATION = 4;

interface DamageParts {
  burst: number;
  /** Dano corpo a corpo do uso (some ao `burst`, mas é reduzido pela resistência a bala). */
  melee: number;
  dotPerSecond: number;
  duration: number;
  cooldown: number;
}

/**
 * Extrai dano em rajada e dano por segundo de um conjunto de propriedades.
 * Usa o maior valor de cada tipo para não somar variantes da mesma habilidade
 * (ex.: dano mínimo e máximo).
 */
function damageParts(props: Record<string, ResolvedProperty>): DamageParts {
  let burst = 0;
  let dotPerSecond = 0;
  let melee = 0;
  for (const [key, p] of Object.entries(props)) {
    if (p.melee) {
      // Golpe leve e pesado da mesma habilidade são alternativos; o maior vale.
      melee = Math.max(melee, p.value);
      continue;
    }
    if (!DAMAGE_KEY.test(key) || NOT_DEALT.test(key) || p.value <= 0) continue;
    if (DOT_KEY.test(key)) dotPerSecond = Math.max(dotPerSecond, p.value);
    else burst = Math.max(burst, p.value);
  }
  const duration = DURATION_KEYS.map((k) => props[k]?.value ?? 0).find((v) => v > 0) ?? DEFAULT_DOT_DURATION;
  return { burst, melee, dotPerSecond, duration, cooldown: props.AbilityCooldown?.value ?? 0 };
}

// Contas por habilidade e por item que só dependem das propriedades resolvidas (objeto
// de cache, imutável) e de poucos números da build, guardados no contexto.
const abilityDamageMemo = memoByObject<Record<string, ResolvedProperty>, number>();
const abilityMeleeMemo = memoByObject<Record<string, ResolvedProperty>, number>();
const itemDamageMemo = memoByObject<Record<string, ResolvedProperty>, ItemDamage[]>();
const itemHealMemo = memoByObject<Record<string, ResolvedProperty>, number>();

/** Dano por segundo de uma habilidade numa luta que começa com ela pronta, usada sempre que volta. */
function abilityDamagePerSecond(props: Record<string, ResolvedProperty>, uptime: number, fight: number): number {
  return abilityDamageMemo(props, contextId([uptime, fight]), () => abilityDamagePerSecondUncached(props, uptime, fight));
}

/** Parte corpo a corpo da habilidade: um golpe por uso (some ao dano de bala). */
function abilityMeleePerSecond(props: Record<string, ResolvedProperty>, fight: number): number {
  return abilityMeleeMemo(props, contextId([fight]), () => {
    const d = damageParts(props);
    return d.cooldown > 0 ? fightDamagePerSecond(d.melee, 0, 0, d.cooldown, fight) : 0;
  });
}

function abilityDamagePerSecondUncached(props: Record<string, ResolvedProperty>, uptime: number, fight: number): number {
  const d = damageParts(props);
  if (d.cooldown <= 0) return d.dotPerSecond * uptime; // passiva: o dano contínuo vale parte do tempo
  return fightDamagePerSecond(d.burst, d.dotPerSecond, d.duration, d.cooldown, fight);
}

interface ItemDamage {
  perSecond: number;
  /** True quando o efeito dispara nas balas da arma. */
  perBullet: boolean;
}

/**
 * Dano por segundo estimado dos efeitos de um item. Cada seção do tooltip
 * (passiva, ativa) é um efeito separado, com suas próprias propriedades.
 */
/**
 * Sangramento acumulado por bala (ex.: Toxic Bullets): cada bala enche uma barra;
 * cheia, o alvo perde uma % da vida máxima por segundo durante a duração.
 */
function bleedPerSecond(props: Record<string, ResolvedProperty>, item: Item, hitsPerSecond: number, firing: number, targetHealth: number): number | null {
  const key = Object.keys(props).find((k) => /HealthPercent/.test(k) && /DPS/.test(item.properties[k]?.unit ?? ""));
  if (!key) return null;
  const perSecond = (props[key]!.value / 100) * targetHealth;
  const buildUp = props.BuildUpPerShot?.value ?? 0;
  if (buildUp <= 0 || hitsPerSecond <= 0) return perSecond * firing;
  // Com a arma atirando, o sangramento fica ativo pela duração a cada barra cheia.
  const secondsToFill = 100 / buildUp / hitsPerSecond;
  const duration = props.DotDuration?.value ?? DEFAULT_DOT_DURATION;
  return perSecond * Math.min(1, duration / secondsToFill) * firing;
}

/** Lista compartilhada (cache): não altere. `context` resume os números da build que a conta lê. */
function itemDamagePerSecond(item: Item, build: BuildResult, hitsPerSecond: number, uptime: number, firing: number, targetHealth: number, fight: number, context: number): ItemDamage[] {
  const all = resolveProperties(item.properties, [], build.stats, build.progression.boons);
  return itemDamageMemo(all, context, () => itemDamagePerSecondUncached(item, all, build, hitsPerSecond, uptime, firing, targetHealth, fight));
}

/** Lê da build só clipSize, bulletsPerShot, bulletDamage e meleeShare (que entram no contexto). */
function itemDamagePerSecondUncached(item: Item, all: Record<string, ResolvedProperty>, build: BuildResult, hitsPerSecond: number, uptime: number, firing: number, targetHealth: number, fight: number): ItemDamage[] {
  const out: ItemDamage[] = [];

  for (const section of item.sections) {
    if (section.type === "innate") continue;
    const props: Record<string, ResolvedProperty> = {};
    for (const key of [...section.properties, ...section.important]) if (all[key]) props[key] = all[key];
    const bleed = section.type === "active" ? null : bleedPerSecond(props, item, hitsPerSecond, firing, targetHealth);
    if (bleed !== null) {
      out.push({ perSecond: bleed, perBullet: true });
      continue;
    }
    const d = damageParts(props);
    if (d.burst <= 0 && d.dotPerSecond <= 0) continue;

    const isActive = section.type === "active";
    const perBullet = !isActive && /your (next )?(bullets?|attacks?)/i.test(section.text);
    const chance = (props.ProcChance?.value ?? 100) / 100;
    const procCooldown = props.ProcCooldown?.value ?? 0;
    const ownCooldown = d.cooldown > 0 ? d.cooldown : isActive ? (all.AbilityCooldown?.value ?? 0) : 0;
    // "Próxima bala" (chance 100%) respeita o cooldown do efeito; proc por chance respeita só a frequência máxima.
    const cooldown = perBullet && chance < 1 ? procCooldown : Math.max(ownCooldown, procCooldown);

    let procsPerSecond: number;
    if (perBullet) {
      procsPerSecond = hitsPerSecond * chance;
      if (cooldown > 0) procsPerSecond = Math.min(procsPerSecond, 1 / cooldown);
      // Bônus que dura "até a próxima recarga": no máximo um pente por cooldown do item.
      const itemCooldown = all.AbilityCooldown?.value ?? 0;
      if (/until your next reload/i.test(section.text) && itemCooldown > 0) {
        procsPerSecond = Math.min(procsPerSecond, (build.stats.clipSize * build.stats.bulletsPerShot) / itemCooldown);
      }
    } else if (cooldown > 0) {
      procsPerSecond = 1 / cooldown;
    } else {
      // Sem cooldown nem gatilho por bala: efeito contínuo, vale pelo tempo ativo.
      out.push({ perSecond: d.dotPerSecond * itemUptime(item, uptime, undefined, undefined, build.meleeShare), perBullet });
      continue;
    }
    // Ativos rendem a cada cooldown; passivos só enquanto a condição acontece
    // (atirando, inimigo por perto); os de corpo a corpo, pelo quanto o herói usa melee.
    let opportunity = isActive ? 1 : perBullet ? firing : uptime;
    if (/melee/i.test(section.text)) opportunity *= build.meleeShare;

    // Quando a seção tem um dano "por bala" explícito, só ele se repete a cada
    // bala; o outro dano da seção (ex.: a carga da habilidade imbuída) sai uma vez por cooldown.
    const bulletKey = perBullet ? Object.keys(props).find((k) => BULLET_DAMAGE_KEY.test(k) && (props[k]?.value ?? 0) > 0) : undefined;
    if (bulletKey) {
      const itemCooldown = all.AbilityCooldown?.value ?? 0;
      // Com unidade "%", o bônus é uma fração do dano da bala, não dano fixo (ex.: Mercurial Magnum).
      const raw = props[bulletKey]!.value;
      const perHit = item.properties[bulletKey]?.unit === "%" ? (raw / 100) * build.stats.bulletDamage : raw;
      const once = itemCooldown > 0 && d.burst > raw ? d.burst / itemCooldown : 0;
      out.push({ perSecond: (perHit * procsPerSecond + once) * opportunity, perBullet });
      continue;
    }
    // Ativo e proc com cooldown que não depende de bala começam a luta prontos (como habilidades).
    if (!perBullet && cooldown > 0) {
      out.push({ perSecond: fightDamagePerSecond(d.burst, d.dotPerSecond, d.duration, cooldown, fight) * opportunity, perBullet });
      continue;
    }
    const perProc = d.burst + d.dotPerSecond * Math.min(d.duration, cooldown > 0 ? cooldown : d.duration);
    out.push({ perSecond: perProc * procsPerSecond * opportunity, perBullet });
  }
  return out;
}

/**
 * Ritmo de corpo a corpo enquanto o herói está batendo: um golpe leve a cada
 * ~1,7 s e um pesado a cada 3 s (o pesado demora a carregar). Escolha do projeto.
 */
const LIGHT_MELEE_PER_SECOND = 0.6;
const HEAVY_MELEE_EVERY = 3;
/** Parte da luta que mesmo quem vive de melee passa colado no alvo, batendo. */
const MELEE_FIGHT_SHARE = 0.35;
const M = "MODIFIER_VALUE_";

interface MeleeParts {
  /** Dano por segundo de golpes corpo a corpo, já ponderado pelo uso de melee do herói. */
  dps: number;
  /** Cura por segundo de itens que curam ao acertar melee (Lifestrike, Melee Lifesteal). */
  heal: number;
}

/**
 * Corpo a corpo: dano dos golpes leves e pesados do herói (com bônus de nível e
 * de itens), o golpe pesado reforçado de Melee Charge e Crushing Fists e as curas
 * por melee. Tudo vale pela fração do tempo em que o herói usa melee
 * (`build.meleeShare`, das estatísticas de compra dos itens de melee).
 */
function meleeParts(build: BuildResult): MeleeParts {
  const share = build.meleeShare;
  const { lightMelee: light, heavyMelee: heavy } = build.stats;
  let dps = light * LIGHT_MELEE_PER_SECOND + heavy / HEAVY_MELEE_EVERY;
  let heal = 0;
  for (const item of build.items) {
    const p = item.properties;
    const cooldown = Math.max(p.AbilityCooldown?.value ?? 0, HEAVY_MELEE_EVERY);
    // "Seu próximo golpe pesado causa X% a mais", uma vez por cooldown.
    const heavyBonus = p.BonusHeavyMeleeDamage?.value ?? 0;
    if (heavyBonus > 0) dps += (heavy * heavyBonus) / 100 / cooldown;
    // Cura fixa + % do dano do golpe, uma vez por cooldown.
    const flat = (p.LifestealHeal?.value ?? 0) + (p.LifestrikeHeal?.value ?? 0);
    const ofDamage = ((p.LifestealHealPercent?.value ?? 0) / 100) * heavy;
    if (flat + ofDamage > 0) heal += (flat + ofDamage) / cooldown;
  }
  // Golpes e curas por golpe só saem no tempo em que o herói está colado no alvo.
  return { dps: dps * share * MELEE_FIGHT_SHARE, heal: heal * share * MELEE_FIGHT_SHARE };
}

/**
 * Chance de um efeito condicionado sair a cada cooldown. Escolhas do projeto:
 * cura que some ao levar dano (Healing Rite) vale metade, porque costuma ser
 * usada entre lutas; parry, purgar debuff e véu dependem de situação e valem menos.
 */
const HEAL_CONDITION: [RegExp, number][] = [
  [/dispelled if you take damage/i, 0.5],
  [/parry/i, 0.25],
  [/purge|if any effects were removed/i, 0.5],
  [/veil/i, 0.3],
  [/headshot/i, 0.3],
];
/** Abates por segundo com o efeito ativo (cura ao abater): ~1 a cada 2 minutos de luta. */
const KILLS_PER_SECOND = 1 / 120;
/** Recargas médias guardadas por uso de itens que acumulam cargas (Restorative Locket). */
const AVERAGE_STACKS = 4;

/**
 * Cura por segundo dos efeitos de itens que curam: cura fixa por uso, regeneração
 * ao causar dano spirit, cura ao lançar habilidade, ao acertar bala, ao abater,
 * em % da vida. Os valores já vêm com o bônus de cura (Healing Booster).
 */
function itemHealPerSecond(build: BuildResult, uptime: number, firing: number, spiritDps: number): number {
  const casts = build.abilities
    .filter((a) => a.slot <= build.progression.abilityUnlocks)
    .reduce((sum, a) => sum + ((a.properties.AbilityCooldown?.value ?? 0) > 0 ? 1 / Math.max(1, a.properties.AbilityCooldown!.value) : 0), 0);
  const healthMax = build.stats.health;
  const context = contextId([healthMax, uptime, firing, casts, spiritDps > 0]);
  let total = 0;
  for (const item of build.items) {
    const p = resolveProperties(item.properties, [], build.stats, build.progression.boons);
    total += itemHealMemo(p, context, () => itemHeal(item, p, healthMax, uptime, firing, spiritDps, casts));
  }
  return total;
}

/** Cura por segundo de um item (só das propriedades resolvidas e dos números passados). */
function itemHeal(item: Item, p: Record<string, ResolvedProperty>, healthMax: number, uptime: number, firing: number, spiritDps: number, casts: number): number {
  {
    const v = (key: string) => p[key]?.value ?? 0;
    const text = item.sections.map((s) => s.text).join(" ");
    const cooldown = Math.max(1, v("AbilityCooldown") || 30);
    const chance = HEAL_CONDITION.find(([re]) => re.test(text))?.[1] ?? 1;
    let heal = 0;
    // Cura total por uso, uma vez por cooldown (Healing Rite, Healing Nova).
    heal += (v("TotalHealthRegen") / cooldown) * chance;
    // Cura fixa ao ativar ou ao acertar a condição (Dispel Magic, Counterspell, Veil Walker).
    heal += ((v("HealOnActivate") + v("HealOnSuccess") + v("HealOnVeil")) / cooldown) * chance;
    // % da vida máxima por uso (Rescue Beam) ou por headshot (Headhunter).
    heal += ((v("HealPercentAmount") / 100) * healthMax) / cooldown;
    heal += ((v("HealPercentPerHeadshot") / 100) * healthMax * firing * chance) / cooldown;
    // Próxima bala em herói (Restorative Shot): só enquanto atira em herói.
    heal += (v("HealFromHero") / cooldown) * firing;
    // Regeneração enquanto causa dano spirit (Mystic e Radiant Regeneration).
    if (spiritDps > 0) heal += v("Regeneration") * Math.min(1, uptime);
    // Cura a cada habilidade lançada, limitada pelo cooldown do item (Radiant Regeneration).
    if (v("HealingPerCast") > 0) heal += v("HealingPerCast") * Math.min(casts, 1 / cooldown) * uptime;
    // Cargas guardadas e consumidas de uma vez (Restorative Locket).
    heal += ((v("HealPerStack") * AVERAGE_STACKS) / cooldown) * uptime;
    // Cura ao abater sob o efeito (Healbane).
    heal += v("HealOnKill") * KILLS_PER_SECOND;
    return heal;
  }
}

/** Fração do tempo que a arma consegue atirar sem parar para recarregar. */
function firingShare(build: BuildResult, options: MetricOptions): number {
  const reloadLimited = build.stats.burstDps > 0 ? build.stats.sustainedDps / build.stats.burstDps : 0;
  return Math.min(options.shooting, reloadLimited);
}

/** Fontes de controle da build, com as mesmas premissas da métrica `control`. */
export function controlBreakdown(build: BuildResult, options: MetricOptions = DEFAULT_METRIC_OPTIONS): ControlSource[] {
  return controlSources(build, options.uptime, firingShare(build, options));
}

export function computeMetrics(build: BuildResult, options: MetricOptions = DEFAULT_METRIC_OPTIONS): Metrics {
  const { stats, conditional } = build;
  const bulletMult = 1 - (options.targetBulletResist - conditional.bulletShredPct) / 100;
  const spiritMult = 1 - (options.targetSpiritResist - conditional.spiritShredPct) / 100;
  const firing = firingShare(build, options);
  const fight = options.fightSeconds ?? fightSeconds();
  const weaponDps = stats.burstDps * firing * bulletMult;
  // Só habilidades já desbloqueadas no nível (a ultimate chega por último).
  const unlocked = build.abilities.filter((a) => a.slot <= build.progression.abilityUnlocks);
  const abilitySpirit = unlocked.reduce((sum, a) => sum + abilityDamagePerSecond(a.properties, options.uptime, fight), 0) * spiritMult;
  // Dano corpo a corpo de habilidade (Puddle Punch, Bashdown) conta como arma: resistência e vulnerabilidade de bala.
  const abilityMelee = unlocked.reduce((sum, a) => sum + abilityMeleePerSecond(a.properties, fight), 0) * bulletMult;
  const abilityDps = abilitySpirit + abilityMelee;
  const hitsPerSecond = stats.shotsPerSecond * stats.bulletsPerShot;
  let itemDps = 0;
  let bulletItemDps = 0;
  const itemContext = contextId([hitsPerSecond, options.uptime, firing, options.targetHealth, fight, stats.clipSize, stats.bulletsPerShot, stats.bulletDamage, build.meleeShare]);
  for (const item of build.items) {
    for (const dmg of itemDamagePerSecond(item, build, hitsPerSecond, options.uptime, firing, options.targetHealth, fight, itemContext)) {
      itemDps += dmg.perSecond * spiritMult;
      if (dmg.perBullet) bulletItemDps += dmg.perSecond * spiritMult;
    }
  }

  const melee = meleeParts(build);
  const meleeDps = melee.dps * bulletMult;
  // Vulnerabilidade no alvo: multiplica o seu dano de bala e de spirit (média na luta).
  const amp = amplification(build, fight, options.uptime);
  const gunBase = weaponDps + bulletItemDps + meleeDps + abilityMelee;
  const spiritBase = abilitySpirit + itemDps - bulletItemDps;
  const gun = gunBase * amp.bullet;
  const spirit = spiritBase * amp.spirit;
  const ampDps = gun + spirit - gunBase - spiritBase;
  const dealt = gun + spirit;
  const antiHeal = antiHealDps(build, dealt, options.uptime, firing, spirit);
  const antiHealShare = dealt > 0 ? antiHeal / dealt : 0;

  const sustain =
    stats.healthRegen +
    melee.heal +
    itemHealPerSecond(build, options.uptime, firing, abilitySpirit + itemDps - bulletItemDps) +
    (stats.bulletLifestealPct / 100) * weaponDps +
    (stats.spiritLifestealPct / 100) * (abilitySpirit + itemDps);

  return {
    weaponDps,
    abilityDps,
    itemDps,
    meleeDps,
    antiHealDps: antiHeal,
    ampDps,
    // A cura negada se divide entre bala e spirit na proporção do dano que a causa.
    gunDps: gun * (1 + antiHealShare),
    spiritDps: spirit * (1 + antiHealShare),
    totalDps: dealt + antiHeal,
    // Vida e resistência, mais barreiras, tempo sem levar dano, proteção contra controle e desvio.
    ehp: effectiveHealth(build),
    sustain,
    fightHp: effectiveHealth(build) + sustain * fight,
    control: controlSources(build, options.uptime, firing).reduce((sum, s) => sum + s.perMinute, 0),
    play: options.plan ? playUtility(build, options.plan, options.fights ? { only: options.fights } : {}) : 0,
  };
}

/** Objetivos prontos: peso de cada métrica (cada uma é normalizada pela build sem itens). */
export const OBJECTIVES = {
  dps: { totalDps: 1 },
  weapon: { gunDps: 1 },
  spirit: { spiritDps: 1 },
  tank: { ehp: 1 },
  sustain: { sustain: 1, ehp: 0.3 },
  bruiser: { totalDps: 0.5, ehp: 0.5 },
  // Tanque e sustentação juntos: vida efetiva mais a cura durante a luta, na mesma unidade.
  survival: { fightHp: 1 },
  // Dano máximo com defesa ok: o piso de vida efetiva é recalculado pelo otimizador a
  // partir das builds publicadas mais jogadas; 1,5x a referência é o valor sem estatísticas.
  optimized: { totalDps: 1, ehpFloor: 1.5 },
  // Controle de grupo com dano e a mesma defesa da "Otimizada".
  // As jogadas simuladas (alvos atingidos, controle útil, sobreviver para executar) pesam
  // mais que os segundos de controle somados, que não sabem se o alvo estava dentro.
  control: { play: 0.5, control: 0.2, totalDps: 0.3, ehpFloor: 1.5 },
} satisfies Record<string, Weights>;

export type Objective = keyof typeof OBJECTIVES;
export type Weights = Partial<Record<keyof Metrics, number>> & {
  /**
   * Piso de vida efetiva, em múltiplos da referência. Abaixo dele a pontuação cai
   * rápido (fator (vida/piso)³); acima, vida a mais não soma pontos.
   */
  ehpFloor?: number;
};

/**
 * Pontuação de uma build: soma ponderada de cada métrica dividida pelo valor
 * da build de referência (sem itens, mesmos souls). 1,0 = igual à referência.
 */
export function score(metrics: Metrics, baseline: Metrics, weights: Weights, reference: Metrics = baseline): number {
  let total = 0;
  let weightSum = 0;
  for (const [key, weight] of Object.entries(weights) as [keyof Metrics, number][]) {
    if ((key as string) === "ehpFloor") continue;
    // Piso evita divisão por ~0 quando a referência quase não tem a métrica.
    const base = Math.max(baseline[key], 1);
    total += weight * (metrics[key] / base);
    weightSum += weight;
  }
  if (weightSum === 0) return 0;
  // O piso de defesa é medido contra a referência do mesmo nível (na montagem compra
  // a compra, o herói sem itens naquele momento da partida).
  const floor = weights.ehpFloor ? weights.ehpFloor * Math.max(reference.ehp, 1) : 0;
  // Abaixo do piso a nota despenca; acima, vida a mais ainda vale, com retorno decrescente
  // (sem isso a build cumpre o piso com o item mais barato e vira "papel" no fim de jogo).
  const ratio = floor > 0 ? metrics.ehp / floor : 1;
  const defense = ratio < 1 ? ratio ** 3 : ratio ** DEFENSE_ABOVE_FLOOR;
  return (total / weightSum) * defense;
}
