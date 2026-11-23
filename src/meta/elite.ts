/**
 * O que os jogadores de elo alto fazem com cada herói (deadlock-api.com, filtro
 * min_average_badge): itens comprados e quando, e a ordem das habilidades.
 * Baixado por `npm run elite` e gravado em data/snapshot/elite.json.
 *
 * Serve de referência ao lado das builds publicadas mais jogadas: aquelas dizem
 * o que a maioria segue; esta diz o que quem joga melhor de fato compra.
 */
import type { Ability, GameData } from "../data/types.ts";
import type { ItemUsage, PopularBuild } from "./stats.ts";

export interface EliteAbilityPick {
  /** Slot da habilidade (1 a 4). */
  slot: number;
  matches: number;
  wins: number;
}

export interface EliteAbilityOrder {
  /** Slot de cada ponto gasto, na ordem (desbloqueios e upgrades). */
  slots: number[];
  matches: number;
  wins: number;
}

export interface HeroElite {
  heroId: number;
  /** Badge mínimo médio da partida usado para este herói (ex.: 101 = Ascendant 1). */
  badge: number;
  matches: number;
  wins: number;
  /** Uso por item no elo alto, indexado por class_name. */
  items: Record<string, ItemUsage>;
  /** Habilidade maximizada primeiro, da mais comum para a menos. */
  maxFirst: EliteAbilityPick[];
  /** Ordem completa mais jogada; null quando nenhuma tem amostra suficiente. */
  order: EliteAbilityOrder | null;
}

export interface EliteStats {
  fetchedAt: string;
  days: number;
  /** Badge pedido primeiro; heróis com pouca amostra caem para `fallbackBadge`. */
  badge: number;
  fallbackBadge: number;
  /** Fração das partidas do período com badge médio >= `badge` (o "top X%"). */
  share: number;
  heroes: Record<string, HeroElite>;
}

/** Fração mínima das partidas do herói em elo alto para o item entrar no caminho. */
export const ELITE_PATH_MIN_RATE = 0.3;

export const heroElite = (data: GameData, heroId: number): HeroElite | null => data.elite?.heroes[String(heroId)] ?? null;

/** Nome do badge no formato do jogo: 101 → "Ascendant 1". */
export function badgeName(badge: number): string {
  const RANKS = ["Obscurus", "Initiate", "Seeker", "Alchemist", "Arcanist", "Ritualist", "Emissary", "Archon", "Oracle", "Phantom", "Ascendant", "Eternus"];
  const rank = RANKS[Math.floor(badge / 10)] ?? `Rank ${Math.floor(badge / 10)}`;
  return `${rank} ${badge % 10}`;
}

/**
 * O caminho de itens do elo alto como uma "build": itens comprados em pelo menos
 * `minRate` das partidas, na ordem do minuto médio de compra. Assim ele passa pela
 * mesma comparação que as builds publicadas (mesmo motor, mesmos souls).
 */
export function elitePath(data: GameData, heroId: number, minRate = ELITE_PATH_MIN_RATE): PopularBuild | null {
  const elite = heroElite(data, heroId);
  if (!elite || elite.matches <= 0) return null;
  const known = new Set(data.items.map((i) => i.className));
  const core = Object.entries(elite.items)
    .filter(([cls, u]) => known.has(cls) && u.matches / elite.matches >= minRate && Number.isFinite(u.buyMinute))
    .sort((a, b) => a[1].buyMinute - b[1].buyMinute)
    .map(([cls]) => cls);
  if (core.length === 0) return null;
  return { id: 0, name: `${badgeName(elite.badge)}+`, matches: elite.matches, wins: elite.wins, core, optional: [] };
}

/** Habilidades do herói na ordem dos pontos do elo alto (null sem dados). */
export function eliteAbilityOrder(data: GameData, heroId: number, abilities: Ability[]): { abilities: Ability[]; share: number; winrate: number } | null {
  const elite = heroElite(data, heroId);
  if (!elite?.order) return null;
  const bySlot = new Map(abilities.map((a) => [a.slot, a]));
  const list = elite.order.slots.map((s) => bySlot.get(s)).filter((a): a is Ability => a !== undefined);
  if (list.length !== elite.order.slots.length) return null;
  return { abilities: list, share: elite.order.matches / Math.max(1, elite.matches), winrate: elite.order.wins / Math.max(1, elite.order.matches) };
}

/** Habilidade mais maximizada primeiro no elo alto, com a fração das partidas. */
export function eliteMaxFirst(data: GameData, heroId: number): { slot: number; share: number }[] {
  const elite = heroElite(data, heroId);
  if (!elite) return [];
  const total = elite.maxFirst.reduce((s, p) => s + p.matches, 0);
  return elite.maxFirst.map((p) => ({ slot: p.slot, share: p.matches / Math.max(1, total) }));
}
