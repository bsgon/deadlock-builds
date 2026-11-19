/** Vocabulário de etiquetas do grafo de interações. */

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

export const STAT_LABEL: Record<Stat, string> = {
  spiritPower: "Spirit Power",
  weaponDamage: "dano de arma",
  fireRate: "cadência de tiro",
  ammo: "munição",
  reload: "recarga",
  cooldown: "redução de cooldown",
  itemCooldown: "redução de cooldown de itens",
  duration: "duração",
  range: "alcance/raio",
  charges: "cargas",
  health: "vida",
  barrier: "barreira",
  bulletResist: "resistência a bala",
  spiritResist: "resistência a spirit",
  moveSpeed: "velocidade",
  bulletLifesteal: "lifesteal de bala",
  spiritLifesteal: "lifesteal de spirit",
  healing: "cura",
  healAmp: "amplificação de cura",
  regen: "regeneração",
  melee: "dano corpo a corpo",
  stamina: "stamina",
  damageAmp: "amplificação de dano",
};

export const TRIGGER_LABEL: Record<Trigger, string> = {
  active: "ao ativar",
  imbue: "imbuído numa habilidade",
  onBullet: "ao acertar balas",
  onHeadshot: "ao acertar headshot",
  onMelee: "ao acertar corpo a corpo",
  onParry: "ao aparar",
  onSpiritDamage: "ao causar dano de spirit",
  onAbilityHit: "quando uma habilidade causa dano",
  onAbilityUse: "ao usar habilidade",
  onUltimate: "ao usar o ultimate",
  onHeal: "ao curar",
  onKill: "ao matar ou dar assistência",
  onMovement: "ao usar movimento (dash, slide, ar)",
  highHealth: "com vida alta",
  lowHealth: "com vida baixa",
  closeRange: "a curta distância",
  longRange: "a longa distância",
  takingDamage: "ao receber dano",
};
