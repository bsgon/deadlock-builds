/**
 * Regras de venda da rota: quando vale vender um item para abrir slot.
 *
 * Vender devolve metade do preço, então um item vendido logo depois de comprado só
 * perde souls. Estas regras valem para as vendas do otimizador; não são regras da loja
 * (essas ficam em route.ts). Ver docs/plano-builds-v2.md, seção 4.4.
 */
import type { GameData, Item } from "../data/types.ts";
import { componentTree, equippedItems } from "../engine/inventory.ts";
import { SELL_REFUND } from "../engine/rules.ts";
import type { PurchaseStep } from "./optimize.ts";

/** Posse mínima antes de vender, em minutos (jogadores: p10 de 11,3 a 12,5). Um upgrade reinicia a contagem. */
export const MIN_HOLD_MINUTES = 10;
/** Ganho mínimo de pontuação de uma troca, como fração da pontuação antes dela. */
export const MIN_SALE_GAIN = 0.05;
/** Degrau de investimento que uma venda não pode desfazer. */
export const INVESTMENT_STEP = 4800;

const SLOTS: Item["slot"][] = ["weapon", "vitality", "spirit"];

/** Histórico de cada item equipado: minuto em que entrou e se entrou no lugar de um vendido. */
export type Holdings = Map<string, { minute: number; fromSale: boolean }>;

/** Histórico depois de uma compra (`after` = inventário depois dela). */
export function holdAfter(data: GameData, held: Holdings, item: Item, minute: number, sold: Item | null, after: Item[]): Holdings {
  const tree = componentTree(data, item);
  // O upgrade de um item que entrou por troca continua sendo o item da troca.
  const inherited = [...held].some(([cls, h]) => h.fromSale && tree.has(cls));
  const next: Holdings = new Map([...held].filter(([cls]) => after.some((i) => i.className === cls)));
  next.set(item.className, { minute, fromSale: sold !== null || inherited });
  return next;
}

/** O item já foi usado tempo bastante e não entrou por troca. */
export function canSell(held: Holdings, item: Item, minute: number): boolean {
  const h = held.get(item.className);
  return h === undefined || (!h.fromSale && minute - h.minute >= MIN_HOLD_MINUTES);
}

/** A troca não desce nenhuma árvore abaixo do degrau já alcançado. Listas de itens equipados. */
export function keepsInvestment(before: Item[], after: Item[]): boolean {
  const invested = (items: Item[], slot: Item["slot"]) => items.reduce((s, i) => s + (i.slot === slot ? i.cost : 0), 0);
  return SLOTS.every((slot) => invested(before, slot) < INVESTMENT_STEP || invested(after, slot) >= INVESTMENT_STEP);
}

export interface Sale {
  sold: Item;
  bought: Item;
  /** Minutos entre a compra (ou o upgrade) e a venda. */
  held: number;
  /** Souls perdidos na venda. */
  loss: number;
  /** Ganho da troca, como fração da pontuação antes dela. */
  gain: number;
  /** O vendido tinha entrado por troca. */
  chain: boolean;
  /** A troca manteve o degrau de investimento. */
  keepsStep: boolean;
}

/** As vendas de uma rota, com o que cada uma custou e rendeu. */
export function routeSales(data: GameData, order: PurchaseStep[]): Sale[] {
  const sales: Sale[] = [];
  let owned: Item[] = [];
  let held: Holdings = new Map();
  for (const step of order) {
    const after = equippedItems(data, [...owned.filter((i) => i !== step.sold), step.item]);
    if (step.sold) {
      const h = held.get(step.sold.className);
      const before = step.score - step.gain;
      sales.push({
        sold: step.sold,
        bought: step.item,
        held: step.minute - (h?.minute ?? 0),
        loss: step.sold.cost - Math.round(step.sold.cost * SELL_REFUND),
        gain: before > 0 ? step.gain / before : 0,
        chain: h?.fromSale ?? false,
        keepsStep: keepsInvestment(owned, after),
      });
    }
    owned = after;
    held = holdAfter(data, held, step.item, step.minute, step.sold, owned);
  }
  return sales;
}
