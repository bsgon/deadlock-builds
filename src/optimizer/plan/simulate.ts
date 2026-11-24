/**
 * Simula uma rota de compras e mede quanto ela vale na partida inteira.
 *
 * Uma rota é uma lista de intenções (comprar X, talvez vendendo Y). A simulação anda
 * pelos souls, pula o que não for possível (slots, ativos, tiers, travas de venda) e
 * devolve as compras feitas. Assim qualquer lista, mesmo mexida pela busca, vira uma
 * rota que o jogo aceita.
 *
 *   J = Σ P(partida dura até t) · ln(pontuação(t)) / Σ P(partida dura até t)
 *
 * Os souls perdidos numa venda atrasam tudo o que vem depois, e um item que sai logo
 * rende pouco tempo: a venda se paga ou não dentro da própria conta.
 */
import type { GameData, Item } from "../../data/types.ts";
import { componentTree, equippedItems, owns } from "../../engine/inventory.ts";
import { MAX_ACTIVE_ITEMS, SELL_REFUND } from "../../engine/rules.ts";
import { canSell, holdAfter, keepsInvestment, MIN_SALE_GAIN, type Holdings } from "../sales.ts";

export interface Intent {
  item: Item;
  sold: Item | null;
}

export interface PlanStep extends Intent {
  pay: number;
  /** Souls ganhos na partida no momento da compra. */
  earned: number;
  upgradeFrom: Item | null;
  before: Item[];
  after: Item[];
}

export interface Cell {
  from: number;
  to: number;
  /** Souls em que a pontuação do trecho é medida. */
  souls: number;
  /** P(partida dura até o meio do trecho). */
  alive: number;
}

export interface PlanContext {
  data: GameData;
  /** Souls da build: nada é comprado depois. */
  souls: number;
  required: Set<string>;
  /** Souls a partir dos quais cada tier entra (índice = tier). */
  gates: number[];
  /** Souls a partir dos quais cabem n itens (índice = n); Infinity acima do limite. */
  slotSouls: number[];
  /** Trechos da partida, em souls, do começo ao fim. */
  cells: Cell[];
  /** Pontuação das escolhas (com uso e partidas) e a mostrada na tela. */
  scoreAt: (items: Item[], souls: number) => number;
  rawScoreAt: (items: Item[], souls: number) => number;
  /** Ajuste (log) de cada item pelas partidas. */
  bonus: Map<string, number>;
  minuteAt: (souls: number) => number;
  patient: (from: number, at: number, pay: number) => boolean;
  /** Pico de vitality, quando vale para a build. */
  spike: { souls: number; deadline: number } | null;
  /** O item de tier 3+ é vendido de verdade pelos jogadores do herói. */
  sellsHighTier: (item: Item) => boolean;
  /** Travas de venda (sales.ts) ligadas. */
  saleRules: boolean;
}

/** Vendas permitidas até `LATE_SALE_SOULS` e no total (docs/plano-builds-v2.md, 4.4). */
export const MAX_EARLY_SALES = 1;
export const MAX_SALES = 3;
export const LATE_SALE_SOULS = 40_000;

/** Punições em J: rota que deixa item fixado de fora, perde o pico de vitality ou espera demais. */
const MISSING_REQUIRED = 5;
const MISSED_SPIKE = 1;
const IMPATIENT = 0.05;

export interface Route {
  steps: PlanStep[];
  /** J já com as punições: o que a busca maximiza. */
  value: number;
  /** J sem punições. */
  j: number;
  key: string;
}

const listCost = (items: Item[]) => items.reduce((s, i) => s + i.cost, 0);
const vitality = (items: Item[]) => items.reduce((s, i) => s + (i.slot === "vitality" ? i.cost : 0), 0);

/** Executa as intenções. */
export function simulate(ctx: PlanContext, intents: Intent[]): Route {
  const { data } = ctx;
  let owned: Item[] = [];
  let held: Holdings = new Map();
  let earned = 0;
  let sales = 0;
  let impatient = 0;
  let spikeAt: number | null = null;
  const gone = new Set<string>();
  const steps: PlanStep[] = [];

  for (const intent of intents) {
    const { item } = intent;
    if (gone.has(item.className) || owns(data, owned, item)) continue;
    const isRequired = ctx.required.has(item.className);
    const tree = componentTree(data, item);
    const attempt = (sold: Item | null) => {
      const next = equippedItems(data, [...owned.filter((i) => i !== sold), item]);
      if (next.filter((i) => i.isActive).length > MAX_ACTIVE_ITEMS) return null;
      const slotAt = ctx.slotSouls[next.length] ?? Infinity;
      const refund = sold ? sold.cost - Math.round(sold.cost * SELL_REFUND) : 0;
      const pay = listCost(next) - listCost(owned) + refund;
      if (pay <= 0) return null;
      // Slot que ainda não abriu: a compra espera por ele.
      const at = Math.max(earned + pay, slotAt, isRequired ? 0 : (ctx.gates[item.tier] ?? Infinity));
      return at > ctx.souls ? null : { next, pay, at };
    };
    const saleOk = (sold: Item, a: { next: Item[]; at: number }) => {
      if (ctx.required.has(sold.className) || tree.has(sold.className)) return false;
      if (ctx.spike && vitality(a.next) < Math.min(ctx.spike.souls, vitality(owned))) return false;
      if (!ctx.saleRules) return true;
      if (sales >= (a.at < LATE_SALE_SOULS ? MAX_EARLY_SALES : MAX_SALES)) return false;
      if (sold.tier >= 3 && !ctx.sellsHighTier(sold)) return false;
      if (!canSell(held, sold, ctx.minuteAt(a.at)) || !keepsInvestment(owned, a.next)) return false;
      if (isRequired) return true;
      const gains = (s: (items: Item[], souls: number) => number) => {
        const before = s(owned, a.at);
        return s(a.next, a.at) >= before * (1 + MIN_SALE_GAIN);
      };
      return gains(ctx.rawScoreAt) && gains(ctx.scoreAt);
    };

    let sold: Item | null = null;
    let done = attempt(null);
    const wanted = intent.sold && owned.includes(intent.sold) ? intent.sold : null;
    if (wanted && (!done || equippedItems(data, [...owned, item]).length > freeSlots(ctx, earned))) {
      // Só vende quando não há slot livre para a compra na hora em que ela seria paga.
      const swap = attempt(wanted);
      if (swap && saleOk(wanted, swap) && (!done || swap.at < done.at)) {
        done = swap;
        sold = wanted;
      }
    }
    if (!done) continue;
    if (!ctx.patient(earned, done.at, done.pay)) impatient++;
    const before = owned;
    const upgradeFrom = owned.find((i) => tree.has(i.className)) ?? null;
    if (sold) {
      sales++;
      for (const cls of [sold.className, ...componentTree(data, sold)]) gone.add(cls);
    }
    owned = done.next;
    earned = done.at;
    held = holdAfter(data, held, item, ctx.minuteAt(earned), sold, owned);
    if (ctx.spike && spikeAt === null && vitality(owned) >= ctx.spike.souls) spikeAt = earned;
    steps.push({ item, sold, pay: done.pay, earned, upgradeFrom, before, after: owned });
  }

  const j = routeValue(ctx, steps);
  const missing = [...ctx.required].filter((cls) => !owned.some((i) => i.className === cls)).length;
  const missed = ctx.spike && (spikeAt === null || spikeAt > ctx.spike.deadline) ? 1 : 0;
  return {
    steps,
    j,
    value: j - missing * MISSING_REQUIRED - missed * MISSED_SPIKE - impatient * IMPATIENT,
    key: steps.map((s) => `${s.item.className}<${s.sold?.className ?? ""}`).join("|"),
  };
}

/** Itens que cabem com `souls` ganhos. */
function freeSlots(ctx: PlanContext, souls: number): number {
  let n = 0;
  while (n + 1 < ctx.slotSouls.length && ctx.slotSouls[n + 1]! <= souls) n++;
  return n;
}

/** J de uma rota já executada. */
export function routeValue(ctx: PlanContext, steps: Pick<PlanStep, "earned" | "after">[]): number {
  const cache = new Map<Item[], number>();
  const bonusOf = (items: Item[]) => {
    let b = cache.get(items);
    if (b === undefined) cache.set(items, (b = items.reduce((s, i) => s + (ctx.bonus.get(i.className) ?? 0), 0)));
    return b;
  };
  let sum = 0;
  let weight = 0;
  let k = 0;
  let owned: Item[] = [];
  for (const cell of ctx.cells) {
    // Compras feitas antes do trecho.
    while (k < steps.length && steps[k]!.earned <= cell.from) owned = steps[k++]!.after;
    let at = cell.from;
    const piece = (to: number) => {
      const share = (to - at) / (cell.to - cell.from);
      if (share > 0) sum += cell.alive * share * (Math.log(Math.max(1e-6, ctx.scoreAt(owned, cell.souls))) + bonusOf(owned));
      at = to;
    };
    while (k < steps.length && steps[k]!.earned < cell.to) {
      piece(steps[k]!.earned);
      owned = steps[k++]!.after;
    }
    piece(cell.to);
    weight += cell.alive;
  }
  return weight > 0 ? sum / weight : 0;
}
