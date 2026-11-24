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

/** Um ponto de habilidade no caminho de consenso: o ramo mais jogado a partir dos pontos anteriores. */
export interface EliteAbilityStep {
  slot: number;
  /** Partidas que seguiram o caminho até este ponto. */
  matches: number;
  /** Fração de quem chegou ao ponto anterior por este caminho e escolheu esta habilidade. */
  share: number;
  /** Minuto médio do ponto. */
  minute: number;
}

/** Partidas mínimas para o próximo ramo contar como consenso. */
export const ELITE_STEP_MIN_MATCHES = 50;

/** Nó da árvore de ordens da API: um prefixo e quantas partidas começam com ele. */
export interface OrderNode {
  abilities: number[];
  matches: number;
  avg_upgrade_time_s: number;
}

/**
 * Segue, ponto a ponto, o ramo mais jogado da árvore. Para quando a amostra acaba
 * ou aparece uma habilidade fora do kit atual (patch antigo).
 */
export function consensusPath(nodes: OrderNode[], slotOf: (abilityId: number) => number | undefined): EliteAbilityStep[] {
  const children = new Map<string, OrderNode[]>();
  for (const n of nodes) {
    const parent = n.abilities.slice(0, -1).join(",");
    const list = children.get(parent);
    if (list) list.push(n);
    else children.set(parent, [n]);
  }
  const path: EliteAbilityStep[] = [];
  let prefix: number[] = [];
  for (;;) {
    const options = children.get(prefix.join(",")) ?? [];
    const best = options.reduce<OrderNode | null>((a, b) => (!a || b.matches > a.matches ? b : a), null);
    if (!best || best.matches < ELITE_STEP_MIN_MATCHES) return path;
    const slot = slotOf(best.abilities.at(-1)!);
    // Cada habilidade tem um desbloqueio e três upgrades.
    if (slot === undefined || path.filter((s) => s.slot === slot).length >= 4) return path;
    const total = options.reduce((s, n) => s + n.matches, 0);
    path.push({ slot, matches: best.matches, share: best.matches / total, minute: Math.round((best.avg_upgrade_time_s / 60) * 10) / 10 });
    prefix = best.abilities;
  }
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
  /** Caminho de consenso, ponto a ponto (ausente em snapshots antigos). */
  path?: EliteAbilityStep[];
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

export interface AbilityPoint {
  slot: number;
  /** 0 = desbloqueio; 1 a 3 = upgrade. */
  tier: number;
  minute: number | null;
  share: number | null;
}

/**
 * Ordem dos pontos de habilidade: o caminho de consenso ou, se ele for curto (menos de
 * `minSteps` pontos), a sequência completa mais jogada. Null sem nenhum dos dois.
 */
export function abilityPoints(elite: HeroElite | null, minSteps = 10): { points: AbilityPoint[]; source: "path" | "order" } | null {
  if (!elite) return null;
  const usePath = (elite.path?.length ?? 0) >= minSteps;
  const steps = usePath ? elite.path!.map((s) => ({ slot: s.slot, minute: s.minute, share: s.share })) : (elite.order?.slots ?? []).map((slot) => ({ slot, minute: null, share: null }));
  if (!steps.length) return null;
  const seen = new Map<number, number>();
  const points = steps.flatMap((s): AbilityPoint[] => {
    const tier = seen.get(s.slot) ?? 0;
    seen.set(s.slot, tier + 1);
    return tier <= 3 ? [{ ...s, tier }] : [];
  });
  // Só uma habilidade incompleta: os pontos que faltam só podem ir para ela.
  const open = [1, 2, 3, 4].filter((slot) => (seen.get(slot) ?? 0) < 4);
  if (open.length === 1) for (let tier = seen.get(open[0]!) ?? 0; tier <= 3; tier++) points.push({ slot: open[0]!, tier, minute: null, share: null });
  return { points, source: usePath ? "path" : "order" };
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
