/**
 * Estatísticas de partidas reais (deadlock-api.com/v1/analytics), baixadas por
 * `npm run stats` e gravadas em data/snapshot/stats.json.
 *
 * Servem para três coisas que o motor sozinho não sabe: quantos souls um herói
 * costuma ter em cada minuto, em que duração de partida ele vence mais, e o que
 * os jogadores realmente compram (itens e builds publicadas mais jogadas).
 */
import type { GameData, Item } from "../data/types.ts";
import { equippedItems, owns } from "../engine/inventory.ts";
import { MAX_ACTIVE_ITEMS, MID_GAME_MINUTE } from "../engine/rules.ts";

export interface DurationBucket {
  /** Duração mínima da partida, em minutos. */
  fromMin: number;
  /** Duração máxima (exclusiva), ou null para "em diante". */
  toMin: number | null;
  matches: number;
  wins: number;
}

export interface ItemUsage {
  matches: number;
  wins: number;
  /** Minuto médio de compra. */
  buyMinute: number;
}

/** Build publicada no navegador de builds do jogo, com o uso dela em partidas. */
export interface PopularBuild {
  id: number;
  name: string;
  matches: number;
  wins: number;
  /** class_name dos itens das categorias principais, na ordem da build. */
  core: string[];
  /** class_name dos itens marcados como opcionais pelo autor. */
  optional: string[];
}

export interface HeroMeta {
  heroId: number;
  matches: number;
  wins: number;
  /** Souls médios do herói em cada minuto de partida (índice = minuto). */
  soulsByMinute: number[];
  byDuration: DurationBucket[];
  /** Uso por item, indexado por class_name. */
  items: Record<string, ItemUsage>;
  /** Builds publicadas mais jogadas, da mais jogada para a menos. */
  builds: PopularBuild[];
}

export interface MetaStats {
  fetchedAt: string;
  /** Janela das estatísticas, em dias até `fetchedAt`. */
  days: number;
  /** Indexado pelo id do herói. */
  heroes: Record<string, HeroMeta>;
}

export const heroMeta = (data: GameData, heroId: number): HeroMeta | null => data.stats?.heroes[String(heroId)] ?? null;

/** Souls por minuto quando não há estatística do herói (média geral medida em nov/2026). */
const FALLBACK_SOULS_PER_MINUTE = [0, 600, 1200, 1800, 2500, 3200, 3900, 4600, 5400, 6200, 7000, 8000, 9000, 10000, 11000, 12100];

/** Souls médios do herói num minuto de partida, interpolando entre os minutos medidos. */
export function soulsAtMinute(data: GameData, heroId: number, minute: number): number {
  const curve = heroMeta(data, heroId)?.soulsByMinute;
  const table = curve && curve.length > 1 ? curve : FALLBACK_SOULS_PER_MINUTE;
  const last = table.length - 1;
  if (minute >= last) return table[last]! + (minute - last) * (table[last]! - table[last - 1]!);
  const lo = Math.floor(minute);
  const f = minute - lo;
  return Math.round(table[lo]! * (1 - f) + table[lo + 1]! * f);
}

/** Minuto em que o herói costuma chegar a um total de souls. */
export function minuteForSouls(data: GameData, heroId: number, souls: number): number {
  for (let m = 0; m < 90; m += 0.25) if (soulsAtMinute(data, heroId, m) >= souls) return m;
  return 90;
}

/** Souls do herói no começo do mid game: o prazo para o pico de vitality. */
export const midGameSouls = (data: GameData, heroId: number, minute = MID_GAME_MINUTE): number => soulsAtMinute(data, heroId, minute);

export interface PowerWindow {
  bucket: DurationBucket;
  winrate: number;
  /** Diferença para o winrate geral do herói, em pontos percentuais. */
  lift: number;
}

/** Faixas de duração de partida com o winrate do herói em cada uma. */
export function powerWindows(meta: HeroMeta): PowerWindow[] {
  const overall = meta.wins / Math.max(1, meta.matches);
  return meta.byDuration
    .filter((b) => b.matches > 0)
    .map((bucket) => {
      const winrate = bucket.wins / bucket.matches;
      return { bucket, winrate, lift: (winrate - overall) * 100 };
    });
}

/** Fração das partidas do herói em que o item foi comprado. */
export function pickRate(meta: HeroMeta, item: Item): number | null {
  const usage = meta.items[item.className];
  return usage ? usage.matches / Math.max(1, meta.matches) : null;
}

/** Souls ganhos em que cada tier costuma aparecer quando não há estatística do herói. */
const FALLBACK_TIER_GATES = [0, 0, 6000, 13000, 26000, 40000];
/** Fração das compras de um tier que já aconteceram no ponto escolhido como "comum". */
const GATE_QUANTILE = 0.1;

/**
 * Souls ganhos a partir dos quais o herói costuma comprar itens de cada tier
 * (índice = tier). Vem do minuto médio de compra de cada item, convertido em
 * souls pela curva do herói, e fica no ponto em que 10% das compras daquele
 * tier (ponderadas pelo número de partidas) já aconteceram. Tier 1 é livre.
 */
export function tierGates(data: GameData, heroId: number): number[] {
  const meta = heroMeta(data, heroId);
  if (!meta) return FALLBACK_TIER_GATES;
  const byClass = new Map(data.items.map((i) => [i.className, i]));
  const samples: [number, number][][] = [[], [], [], [], [], []];
  for (const [cls, usage] of Object.entries(meta.items)) {
    const item = byClass.get(cls);
    if (item && item.tier >= 2 && item.tier <= 4) samples[item.tier]!.push([soulsAtMinute(data, heroId, usage.buyMinute), usage.matches]);
  }
  const gates = [...FALLBACK_TIER_GATES];
  for (let tier = 2; tier <= 4; tier++) {
    const list = samples[tier]!.sort((a, b) => a[0] - b[0]);
    const total = list.reduce((s, [, w]) => s + w, 0);
    let acc = 0;
    for (const [souls, weight] of list) {
      acc += weight;
      if (acc >= GATE_QUANTILE * total) {
        gates[tier] = Math.round(souls);
        break;
      }
    }
  }
  // Tiers mais caros nunca liberam antes dos mais baratos.
  for (let tier = 3; tier < gates.length; tier++) gates[tier] = Math.max(gates[tier]!, gates[tier - 1]!);
  return gates;
}

/** Minuto médio em que os jogadores compram o item com o herói (null sem dados). */
export function buyMinute(data: GameData, heroId: number, item: Item): number | null {
  return heroMeta(data, heroId)?.items[item.className]?.buyMinute ?? null;
}

/**
 * Compra os itens principais da build publicada na ordem do autor até onde os
 * souls e os slots deixam. Um item que não cabe é pulado, e o seguinte é tentado.
 */
export function popularAtSouls(data: GameData, build: PopularBuild, souls: number, slots: number): Item[] {
  const byClass = new Map(data.items.map((i) => [i.className, i]));
  let owned: Item[] = [];
  const equipped = (items: Item[]) => equippedItems(data, items);
  const cost = (items: Item[]) => equipped(items).reduce((sum, i) => sum + i.cost, 0);
  for (const cls of build.core) {
    const item = byClass.get(cls);
    // Item repetido na build, ou já dentro de um upgrade comprado, não entra de novo.
    if (!item || item.tier > 4 || owns(data, owned, item)) continue;
    const next = equipped([...owned, item]);
    if (cost(next) > souls || next.length > slots || next.filter((i) => i.isActive).length > MAX_ACTIVE_ITEMS) continue;
    owned = next;
  }
  return owned;
}

/** Itens disparados por ataque corpo a corpo (Spirit Snatch, Lifestrike, Melee Charge...). */
const MELEE_TRIGGER = /melee attack|heavy melee|light melee|your melee/i;
/** Fração do tempo em luta com ataques corpo a corpo quando não há estatística do herói. */
export const DEFAULT_MELEE_SHARE = 0.5;
/** Faixa do fator: mesmo quem quase não usa melee acerta um de vez em quando; ninguém só bate. */
const MELEE_SHARE_MIN = 0.05;
const MELEE_SHARE_MAX = 0.9;
/** Taxa média de compra dos itens de melee a partir da qual o herói conta como "vive de melee". */
const MELEE_PICK_FULL = 0.7;

const meleeCache = new WeakMap<GameData, Map<number, number>>();

/**
 * Quanto o herói usa ataque corpo a corpo, de 0,05 a 0,9: vale como a fração do
 * tempo em luta em que efeitos "ao acertar melee" disparam. Vem da taxa média de
 * compra dos itens disparados por melee com o herói: Billy e Abrams compram em
 * 70-95% das partidas; Haze e Seven, em quase nenhuma.
 */
export function meleeShare(data: GameData, heroId: number): number {
  let cache = meleeCache.get(data);
  if (!cache) meleeCache.set(data, (cache = new Map()));
  const hit = cache.get(heroId);
  if (hit !== undefined) return hit;
  const rate = meleePickRate(data, heroId);
  const share = rate === null ? DEFAULT_MELEE_SHARE : MELEE_SHARE_MIN + (MELEE_SHARE_MAX - MELEE_SHARE_MIN) * Math.min(1, rate / MELEE_PICK_FULL);
  cache.set(heroId, share);
  return share;
}

/** Taxa média de compra dos itens de melee com o herói (para explicar o fator). */
export function meleePickRate(data: GameData, heroId: number): number | null {
  const meta = heroMeta(data, heroId);
  const items = data.items.filter((i) => i.tier <= 4 && i.sections.some((s) => MELEE_TRIGGER.test(s.text)));
  if (!meta || items.length === 0) return null;
  return items.reduce((sum, i) => sum + (meta.items[i.className]?.matches ?? 0) / Math.max(1, meta.matches), 0) / Math.max(1, items.length);
}
