/** Formato normalizado do snapshot (data/snapshot/*.json). */
import type { MetaStats } from "../meta/stats.ts";
import type { PurchaseWindows } from "../meta/windows.ts";
import type { Interaction } from "../knowledge/interactions.ts";
import type { Theory } from "../knowledge/theories.ts";

export type Slot = "weapon" | "vitality" | "spirit";

/** Como uma propriedade escala com os stats do herói. */
export interface Scale {
  /** class_name da scale_function na API (ex.: scale_function_tech_damage). */
  fn: string | null;
  /** Stats que influenciam o valor (ex.: ETechPower, ETechCooldown, ETechRange). */
  stats: string[];
  /** Coeficiente do stat de "poder" (ex.: 0.6 de dano por Spirit Power). */
  coef: number | null;
}

export interface Property {
  value: number;
  /** Sufixo de unidade vindo da API ("m", "s", "%"...). */
  unit: string;
  label: string | null;
  /** MODIFIER_VALUE_* quando a propriedade concede um stat. */
  provides: string | null;
  flags: string[];
  /** Condição textual da API (ex.: "after proc"). */
  conditional: string | null;
  scale: Scale | null;
}

export type UpgradeType = "addBase" | "addScale" | "mulBase" | "mulScale";

export interface PropertyUpgrade {
  property: string;
  bonus: number;
  type: UpgradeType;
  statFilter: string | null;
}

export interface Ability {
  id: number;
  className: string;
  name: string;
  heroId: number;
  /** 1 a 4 (4 = ultimate). */
  slot: number;
  abilityType: string;
  /** URL do ícone (CDN do deadlock-api.com). */
  image: string | null;
  properties: Record<string, Property>;
  /** Três níveis de upgrade (T1, T2, T3). */
  upgrades: PropertyUpgrade[][];
  text: string;
}

export interface Weapon {
  className: string;
  bulletDamage: number;
  bullets: number;
  shotsPerSecond: number;
  clipSize: number;
  /** Tempo total de recarga em segundos (ver normalize.ts para a derivação). */
  reloadTime: number;
  reloadSingleBullets: boolean;
  headshotMultiplier: number;
  falloff: { startRange: number; endRange: number; startScale: number; endScale: number };
}

export interface HeroSpiritScaling {
  /** Stat afetado (ex.: EBulletDamage, EClipSize, EFireRate). */
  stat: string;
  /** Stat de origem (hoje sempre ETechPower). */
  source: string;
  scale: number;
}

export interface Hero {
  id: number;
  className: string;
  name: string;
  heroType: string | null;
  inDevelopment: boolean;
  /** URL do retrato pequeno (CDN do deadlock-api.com). */
  image: string | null;
  start: Record<string, number>;
  /** Ganho por boon (MODIFIER_VALUE_* -> valor). */
  perBoon: Record<string, number>;
  scaling: HeroSpiritScaling[];
  weapon: Weapon;
  /** class_name das 4 habilidades, na ordem dos slots. */
  abilities: string[];
}

export interface ItemSection {
  type: string;
  text: string;
  properties: string[];
  important: string[];
}

export interface Item {
  id: number;
  className: string;
  name: string;
  slot: Slot;
  tier: number;
  cost: number;
  isActive: boolean;
  activation: string | null;
  /** URL do ícone da loja (CDN do deadlock-api.com). */
  image: string | null;
  /** class_name dos componentes (itens que este item melhora). */
  components: string[];
  /** Stats sempre ativos: MODIFIER_VALUE_* -> soma. */
  innate: Record<string, number>;
  /** Propriedades que dependem de condição, proc ou ativação (não entram no cálculo base). */
  conditional: string[];
  properties: Record<string, Property>;
  /** Bônus do campo `upgrades` do item na API (significado ainda não confirmado). */
  apiUpgrades: PropertyUpgrade[][];
  sections: ItemSection[];
  text: string;
}

export interface LevelInfo {
  level: number;
  /** Souls acumulados necessários. */
  souls: number;
  grants: ("abilityPoint" | "abilityUnlock")[];
}

export interface InvestmentStep {
  souls: number;
  bonus: number;
}

export interface Shared {
  levels: LevelInfo[];
  investment: Record<Slot, InvestmentStep[]>;
  tierPrices: number[];
  trooperSoulShare: number[] | null;
  heroKillSoulShare: number[] | null;
}

export interface SnapshotMeta {
  clientVersion: number;
  versionDate: string | null;
  fetchedAt: string;
  source: string;
  counts: { heroes: number; abilities: number; items: number };
}

export interface GameData {
  meta: SnapshotMeta;
  shared: Shared;
  heroes: Hero[];
  abilities: Ability[];
  items: Item[];
  /** Estatísticas de partidas reais; ausente se `npm run stats` nunca rodou. */
  stats?: MetaStats;
  /** Interações conhecidas da wiki da comunidade (data/snapshot/interactions.json), se existirem. */
  knowledge?: Interaction[];
  /** Theorycraft das builds publicadas (data/snapshot/theories.json), se existir. */
  theories?: Theory[];
  /** Winrate por janela de compra (data/snapshot/windows.json, `npm run windows`), se existir. */
  windows?: PurchaseWindows;
}
