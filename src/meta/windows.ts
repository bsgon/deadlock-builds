/**
 * Winrate por janela de compra (deadlock-api.com, /v1/analytics/item-stats com
 * bucket=game_time_min, partidas normais).
 *
 * Compara o item com o que o mesmo herói compra no mesmo momento da partida,
 * não com a média geral: quem compra um item caro aos 35 minutos já sobreviveu
 * até lá e costuma estar à frente. O momento é o único estado anterior à compra
 * que a API filtra; o filtro de patrimônio dela usa o patrimônio FINAL da
 * partida (informação posterior à compra) e por isso não é usado.
 */
import type { GameData, Item } from "../data/types.ts";

/** Janelas de compra em minutos: [início, fim). A última vai até o fim da partida. */
export const WINDOWS: [number, number | null][] = [
  [0, 10],
  [10, 20],
  [20, 30],
  [30, 40],
  [40, null],
];

export interface PurchaseWindows {
  fetchedAt: string;
  days: number;
  windows: [number, number | null][];
  /** heroId → className → [vitórias, partidas] por janela. */
  heroes: Record<string, Record<string, [number, number][]>>;
}

export const windowIndex = (minute: number) => {
  const i = WINDOWS.findIndex(([from, to]) => minute >= from && (to === null || minute < to));
  return i < 0 ? WINDOWS.length - 1 : i;
};

export const windowLabel = (i: number) => {
  const [from, to] = WINDOWS[i]!;
  return to === null ? `${from}+ min` : `${from}–${to} min`;
};

/** Amostra mínima para usar a janela (abaixo disso a incerteza domina). */
export const MIN_WINDOW_MATCHES = 300;

export interface WindowStat {
  window: string;
  matches: number;
  /** Winrate de quem comprou o item na janela, em %. */
  winrate: number;
  /** Winrate médio das compras do herói na mesma janela (todos os itens), em %. */
  baseline: number;
  /** winrate − baseline, em pontos percentuais. */
  delta: number;
  /** Meia-largura do intervalo de 95% do delta, em pp. */
  margin: number;
}

/** Winrate do item quando comprado na janela do minuto, contra as compras da mesma janela. */
export function windowStat(data: GameData, heroId: number, item: Item, minute: number): WindowStat | null {
  const hero = data.windows?.heroes[String(heroId)];
  if (!hero) return null;
  const i = windowIndex(minute);
  const own = hero[item.className]?.[i];
  if (!own || own[1] < MIN_WINDOW_MATCHES) return null;
  let wins = 0;
  let matches = 0;
  for (const cells of Object.values(hero)) {
    const c = cells[i];
    if (!c) continue;
    wins += c[0];
    matches += c[1];
  }
  if (matches === 0) return null;
  const p = own[0] / own[1];
  const base = wins / matches;
  return {
    window: windowLabel(i),
    matches: own[1],
    winrate: p * 100,
    baseline: base * 100,
    delta: (p - base) * 100,
    margin: 196 * Math.sqrt((p * (1 - p)) / own[1]),
  };
}

/** Desvio-padrão a priori do efeito de um item sobre o winrate, em pp (encolhe amostras pequenas). */
export const PRIOR_SD = 2;
/** Amostra mínima para o peso das partidas (o encolhimento cuida do resto). */
export const MIN_PRIOR_MATCHES = 50;

export interface TierPrior {
  /** De onde vem o Δ: winrate na janela de compra, ou vitória acima do esperado pelo placar (wpa.json). */
  source: "window" | "wpa" | "blend";
  /** Janela de compra (fonte "window") ou minuto médio de compra (fonte "wpa"). */
  window: string;
  matches: number;
  /** Winrate do item menos o das compras do mesmo tier na mesma janela, em pp. */
  delta: number;
  /** Meia-largura do intervalo de 95% do delta, em pp. */
  margin: number;
  /** delta encolhido para zero conforme a incerteza (média a posteriori com priori N(0, PRIOR_SD²)). */
  shrunk: number;
}

const tierCache = new WeakMap<object, Map<string, number>>();

/**
 * Quanto o item vence a mais que os outros itens do MESMO TIER comprados pelo herói
 * na mesma janela. Comparar só no tier tira o viés de riqueza (quem compra tier 4
 * aos 20 minutos já está à frente); o encolhimento evita que 60 partidas de sorte
 * virem uma recomendação.
 */
export function tierPrior(data: GameData, heroId: number, item: Item, minute: number): TierPrior | null {
  const hero = data.windows?.heroes[String(heroId)];
  if (!hero) return null;
  let tiers = tierCache.get(data.items);
  if (!tiers) tierCache.set(data.items, (tiers = new Map(data.items.map((i) => [i.className, i.tier]))));
  const i = windowIndex(minute);
  const own = hero[item.className]?.[i];
  if (!own || own[1] < MIN_PRIOR_MATCHES) return null;
  let wins = 0;
  let matches = 0;
  for (const [cls, cells] of Object.entries(hero)) {
    if (tiers.get(cls) !== item.tier) continue;
    const c = cells[i];
    if (!c) continue;
    wins += c[0];
    matches += c[1];
  }
  if (matches === 0) return null;
  const p = own[0] / own[1];
  const delta = (p - wins / matches) * 100;
  const se = 100 * Math.sqrt((p * (1 - p)) / own[1]);
  return { source: "window", window: windowLabel(i), matches: own[1], delta, margin: 1.96 * se, shrunk: (delta * PRIOR_SD ** 2) / (PRIOR_SD ** 2 + se ** 2) };
}

/**
 * Multiplicador do ganho por soul pelas partidas: exp(peso × delta encolhido / 10 pp),
 * limitado a [0,5; 2]. Peso 1: um item que vence 3 pp a mais que o tier vale ~35% a mais.
 */
export const priorFactor = (prior: TierPrior | null, weight: number) => (prior && weight > 0 ? Math.min(2, Math.max(0.5, Math.exp((weight * prior.shrunk) / 10))) : 1);

/**
 * Diferença de winrate entre dois itens comprados na mesma janela, com o
 * intervalo de 95%. `significant` quando o intervalo não cruza zero.
 */
export function compareInWindow(data: GameData, heroId: number, a: Item, b: Item, minute: number): { diff: number; margin: number; significant: boolean; a: WindowStat; b: WindowStat } | null {
  const sa = windowStat(data, heroId, a, minute);
  const sb = windowStat(data, heroId, b, minute);
  if (!sa || !sb) return null;
  const diff = sa.winrate - sb.winrate;
  const margin = Math.hypot(sa.margin, sb.margin);
  return { diff, margin, significant: Math.abs(diff) > margin, a: sa, b: sb };
}
