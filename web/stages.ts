/**
 * Como a rota é mostrada: início, core (o que a maioria das partidas alcança) e
 * extensão (se a partida alongar), com os itens temporários, as opções flexíveis e
 * os situacionais à parte. Só contas sobre o resultado; a tela fica em build-view.ts.
 */
import type { GameData, Item } from "../src/data/types.ts";
import { equippedItems, owns } from "../src/engine/inventory.ts";
import { SELL_REFUND } from "../src/engine/rules.ts";
import type { Theory } from "../src/knowledge/theories.ts";
import { heroMeta } from "../src/meta/stats.ts";
import { usageRate } from "../src/meta/usage.ts";
import type { OptimizeResult, PurchaseStep } from "../src/optimizer/optimize.ts";
import { phaseOf } from "../src/optimizer/route.ts";

export interface RouteStages {
  start: PurchaseStep[];
  core: PurchaseStep[];
  extension: PurchaseStep[];
  /** Itens equipados no fim do core. */
  coreItems: Item[];
}

/** Divide a rota nas fases do minuto da compra (15 e 30 min). */
export function routeStages(data: GameData, order: PurchaseStep[]): RouteStages {
  const of = (phase: string) => order.filter((s) => phaseOf(s.minute) === phase);
  let coreItems: Item[] = [];
  for (const s of order) {
    if (phaseOf(s.minute) === "fim") break;
    coreItems = equippedItems(data, [...coreItems.filter((i) => i !== s.sold), s.item]);
  }
  return { start: of("início"), core: of("meio"), extension: of("fim"), coreItems };
}

export interface Temporary {
  /** Minuto em que o item é vendido. */
  minute: number;
  /** Souls que não voltam na venda. */
  net: number;
  /** O que entra no lugar. */
  replacedBy: Item;
}

/** Itens da rota que são vendidos depois, por class_name. */
export function temporaries(order: PurchaseStep[]): Map<string, Temporary> {
  const out = new Map<string, Temporary>();
  for (const s of order) if (s.sold) out.set(s.sold.className, { minute: s.minute, net: s.sold.cost - Math.round(s.sold.cost * SELL_REFUND), replacedBy: s.item });
  return out;
}

/** A compra e a alternativa ficam a menos disto (ganho por soul) para a vaga contar como flexível. */
export const FLEX_MARGIN = 0.15;
/** Uso mínimo da alternativa com o herói. */
const FLEX_MIN_PICK = 0.05;
export const MAX_FLEX = 4;

export interface Flex {
  item: Item;
  insteadOf: Item;
  /** Quanto a compra da rota rende a mais por soul, em fração. */
  margin: number;
}

/** Compras em que outro item renderia quase o mesmo, da mais parecida para a menos. */
export function flexOptions(data: GameData, heroId: number, result: OptimizeResult): Flex[] {
  const bought = result.order.map((s) => s.item);
  const sold = temporaries(result.order);
  const seen = new Set<string>();
  return result.order
    .filter((s) => s.alternative && s.margin !== undefined && s.margin >= 0 && s.margin < FLEX_MARGIN)
    // Só vagas que ficam na build: trocar um componente ou um temporário muda o resto da rota.
    .filter((s) => !s.isComponent && !sold.has(s.item.className) && s.alternative!.item.tier === s.item.tier)
    .filter((s) => !owns(data, bought, s.alternative!.item) && (usageRate(data, heroId, s.alternative!.item) ?? 1) >= FLEX_MIN_PICK)
    .map((s) => ({ item: s.alternative!.item, insteadOf: s.item, margin: s.margin! }))
    .sort((a, b) => a.margin - b.margin)
    .filter((f) => !seen.has(f.item.className) && seen.add(f.item.className))
    .slice(0, MAX_FLEX);
}

export const MAX_SITUATIONAL = 6;

/** Respostas a situações, das builds publicadas: só itens fora da build e não contrariadas pelos dados. */
export function situationalPicks(data: GameData, heroId: number, result: OptimizeResult): Theory[] {
  const byClass = new Map(data.items.map((i) => [i.className, i]));
  const taken = new Set<string>();
  return (data.theories ?? [])
    .filter((t) => t.heroId === heroId && t.kind === "situational" && t.condition && t.evidence?.verdict !== "contradicted")
    .filter((t) => {
      const item = byClass.get(t.items[0] ?? "");
      return item !== undefined && !owns(data, result.items, item);
    })
    .sort((a, b) => b.builds.length - a.builds.length)
    .filter((t) => !taken.has(t.items[0]!) && taken.add(t.items[0]!))
    .slice(0, MAX_SITUATIONAL);
}

/** Minuto a partir do qual as partidas contam como longas (limite de uma faixa medida). */
export const LONG_MATCH_MINUTE = 35;

/** Fração das partidas do herói com 35 min ou mais; null sem estatísticas. */
export function longMatchShare(data: GameData, heroId: number): number | null {
  const buckets = heroMeta(data, heroId)?.byDuration ?? [];
  const total = buckets.reduce((s, b) => s + b.matches, 0);
  return total > 0 ? buckets.filter((b) => b.fromMin >= LONG_MATCH_MINUTE).reduce((s, b) => s + b.matches, 0) / total : null;
}
