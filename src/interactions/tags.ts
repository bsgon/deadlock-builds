/** Vocabulário de etiquetas do grafo de interações. */
import { tr } from "../i18n.ts";

/** Recursos que um nó concede a quem o usa, ou dos quais ele se beneficia. */
export const STATS = [
  "spiritPower",
  "weaponDamage",
  "fireRate",
  "ammo",
  "reload",
  "cooldown",
  "itemCooldown",
  "duration",
  "range",
  "charges",
  "health",
  "barrier",
  "bulletResist",
  "spiritResist",
  "moveSpeed",
  "bulletLifesteal",
  "spiritLifesteal",
  "healing",
  "healAmp",
  "regen",
  "melee",
  "stamina",
  "damageAmp",
] as const;
export type Stat = (typeof STATS)[number];

/** Efeitos aplicados no inimigo. */
export const DEBUFFS = ["spiritShred", "bulletShred", "slow", "fireRateSlow", "antiHeal", "damageTaken", "silence", "stun", "disarm", "weaken"] as const;
export type Debuff = (typeof DEBUFFS)[number];

/** Tipos de dano causado. */
export const DAMAGES = ["spirit", "spiritDot", "weapon", "melee", "percentHealth"] as const;
export type Damage = (typeof DAMAGES)[number];

/** O que precisa acontecer para o efeito do nó disparar. */
export const TRIGGERS = [
  "active",
  "imbue",
  "onBullet",
  "onHeadshot",
  "onMelee",
  "onParry",
  "onSpiritDamage",
  "onAbilityHit",
  "onAbilityUse",
  "onUltimate",
  "onHeal",
  "onKill",
  "onMovement",
  "highHealth",
  "lowHealth",
  "closeRange",
  "longRange",
  "takingDamage",
] as const;
export type Trigger = (typeof TRIGGERS)[number];

export type When = "always" | "conditional";

export interface Facets {
  /** Recurso concedido e se é sempre ativo ou depende de condição. */
  gives: Partial<Record<Stat, When>>;
  applies: Debuff[];
  deals: Damage[];
  triggers: Trigger[];
  /** Recurso do qual o nó se beneficia e a força relativa desse benefício. */
  wants: Partial<Record<Stat, number>>;
}

export type NodeKind = "item" | "ability" | "weapon";

export interface Node extends Facets {
  /** class_name do item/habilidade, ou `weapon:<herói>` para a arma. */
  id: string;
  kind: NodeKind;
  name: string;
  /** Preenchido em habilidades e armas. */
  heroId: number | null;
  /** Só em armas: balas que saem por segundo (tiros x projéteis por tiro). */
  hitsPerSecond?: number;
  /** Só em itens: árvore da loja. */
  slot?: "weapon" | "vitality" | "spirit";
}

/**
 * Rótulos no idioma em uso. São getters: a constante é avaliada antes de o idioma
 * ser definido, então o texto é escolhido a cada leitura.
 */
function labels<K extends string>(pairs: Record<K, [string, string]>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of Object.keys(pairs) as K[]) {
    const [pt, en] = pairs[key];
    Object.defineProperty(out, key, { enumerable: true, get: () => tr(pt, en) });
  }
  return out;
}

export const STAT_LABEL: Record<Stat, string> = labels<Stat>({
  spiritPower: ["Spirit Power", "Spirit Power"],
  weaponDamage: ["dano de arma", "weapon damage"],
  fireRate: ["cadência de tiro", "fire rate"],
  ammo: ["munição", "ammo"],
  reload: ["recarga", "reload"],
  cooldown: ["redução de cooldown", "cooldown reduction"],
  itemCooldown: ["redução de cooldown de itens", "item cooldown reduction"],
  duration: ["duração", "duration"],
  range: ["alcance/raio", "range/radius"],
  charges: ["cargas", "charges"],
  health: ["vida", "health"],
  barrier: ["barreira", "barrier"],
  bulletResist: ["resistência a bala", "bullet resist"],
  spiritResist: ["resistência a spirit", "spirit resist"],
  moveSpeed: ["velocidade", "move speed"],
  bulletLifesteal: ["lifesteal de bala", "bullet lifesteal"],
  spiritLifesteal: ["lifesteal de spirit", "spirit lifesteal"],
  healing: ["cura", "healing"],
  healAmp: ["amplificação de cura", "heal amp"],
  regen: ["regeneração", "regen"],
  melee: ["dano corpo a corpo", "melee damage"],
  stamina: ["stamina", "stamina"],
  damageAmp: ["amplificação de dano", "damage amp"],
});

export const TRIGGER_LABEL: Record<Trigger, string> = labels<Trigger>({
  active: ["ao ativar", "on activation"],
  imbue: ["imbuído numa habilidade", "imbued on an ability"],
  onBullet: ["ao acertar balas", "on bullet hit"],
  onHeadshot: ["ao acertar headshot", "on headshot"],
  onMelee: ["ao acertar corpo a corpo", "on melee hit"],
  onParry: ["ao aparar", "on parry"],
  onSpiritDamage: ["ao causar dano de spirit", "on dealing spirit damage"],
  onAbilityHit: ["quando uma habilidade causa dano", "when an ability deals damage"],
  onAbilityUse: ["ao usar habilidade", "on ability use"],
  onUltimate: ["ao usar o ultimate", "on ultimate use"],
  onHeal: ["ao curar", "on healing"],
  onKill: ["ao matar ou dar assistência", "on kill or assist"],
  onMovement: ["ao usar movimento (dash, slide, ar)", "on movement (dash, slide, air)"],
  highHealth: ["com vida alta", "at high health"],
  lowHealth: ["com vida baixa", "at low health"],
  closeRange: ["a curta distância", "at close range"],
  longRange: ["a longa distância", "at long range"],
  takingDamage: ["ao receber dano", "when taking damage"],
});
