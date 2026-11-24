/**
 * Itens que não valem entrar na busca do otimizador para um herói: quase ninguém
 * compra (nem no elo alto) e não têm sinergia forte com o kit. É uma poda da busca,
 * não da tela: esconder uma compra deixaria a rota com souls e slots que não fecham.
 */
import type { GameData, Hero, Item } from "../data/types.ts";
import { componentTree } from "../engine/inventory.ts";
import { buildGraph, heroItemFit, type Graph } from "../interactions/synergy.ts";
import { heroElite } from "./elite.ts";
import { heroMeta, pickRate } from "./stats.ts";

/** Taxa de compra abaixo da qual um item barato (tier 1 e 2) sai. */
export const CHEAP_MIN_PICK = 0.05;
/** Maior tier podado por padrão. */
const CHEAP_MAX_TIER = 2;
/** Sinergia com o kit a partir da qual o item fica mesmo sem compras (escala da wiki em synergy.ts). */
export const STRONG_SYNERGY = 1.6;

const graphs = new WeakMap<GameData["items"], Graph>();
function graphOf(data: GameData): Graph {
  let g = graphs.get(data.items);
  if (!g) graphs.set(data.items, (g = buildGraph(data)));
  return g;
}

/** Maior taxa de compra do item com o herói, entre todos os elos e o elo alto (null sem dados). */
export function bestPickRate(data: GameData, heroId: number, item: Item): number | null {
  const meta = heroMeta(data, heroId);
  const elite = heroElite(data, heroId);
  if (!meta && !elite) return null;
  const all = meta ? (pickRate(meta, item) ?? 0) : 0;
  const high = elite && elite.matches > 0 ? (elite.items[item.className]?.matches ?? 0) / elite.matches : 0;
  return Math.max(all, high);
}

/**
 * Itens podados (class_name). `expensiveMinPick` estende a poda aos tiers 3 e 4, com a
 * taxa dada. Componente de um item usado pelo herói fica; sem estatísticas do herói, nada sai.
 */
export function unusedItems(data: GameData, hero: Hero, expensiveMinPick = 0): Set<string> {
  if (!heroMeta(data, hero.id)) return new Set();
  const graph = graphOf(data);
  const strong = (item: Item) => graph.itemNode.has(item.className) && heroItemFit(graph, hero, item).links.some((l) => l.score >= STRONG_SYNERGY);
  const rates = new Map(data.items.map((i) => [i.className, bestPickRate(data, hero.id, i) ?? 1]));
  const useful = (item: Item, min: number) => rates.get(item.className)! >= min || strong(item);
  const out = new Set<string>();
  for (const item of data.items) {
    const min = item.tier <= CHEAP_MAX_TIER ? CHEAP_MIN_PICK : expensiveMinPick;
    if (min > 0 && !useful(item, min)) out.add(item.className);
  }
  // Só o componente de um item que o herói de fato usa volta: um upgrade raro não justifica o componente.
  for (const item of data.items) if (!out.has(item.className) && useful(item, CHEAP_MIN_PICK)) for (const c of componentTree(data, item)) out.delete(c);
  return out;
}
