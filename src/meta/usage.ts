/**
 * Peso do uso real na escolha dos itens, em todos os tiers: item que quase ninguém
 * compra com o herói precisa render mais no modelo para entrar. Não é veto.
 *
 * Cada item equipado desconta da pontuação (em log) um valor proporcional ao preço e à
 * raridade. Como é um desconto da build inteira, vale igual na compra gulosa, nas
 * trocas e na build-alvo. A pontuação mostrada na tela continua sem o desconto.
 */
import type { GameData, Hero, Item } from "../data/types.ts";
import { heroElite } from "./elite.ts";
import { heroMeta, pickRate } from "./stats.ts";
import { wpaPrior } from "./wpa.ts";

/** Taxa de compra a partir da qual o item não é raro, e abaixo da qual é raro por inteiro. */
export const COMMON_PICK = 0.1;
export const RARE_PICK = 0.01;
/** Partidas do elo alto que valem tanto quanto a taxa de todos os elos. */
const ELITE_SHRINK = 500;
/** Quem compra vence mais que o esperado (WPA): a raridade pesa menos. */
const GOOD_WPA_RELIEF = 0.5;
/** Desconto (log da pontuação) por 1.000 souls de item totalmente raro. Comparação em docs/plano-builds-v2.md. */
export const DEFAULT_USAGE_WEIGHT = 0.02;

/** Taxa de compra usada no peso: a maior entre todos os elos e o elo alto encolhido. Null sem estatísticas. */
export function usageRate(data: GameData, heroId: number, item: Item): number | null {
  const meta = heroMeta(data, heroId);
  if (!meta) return null;
  const all = pickRate(meta, item) ?? 0;
  const elite = heroElite(data, heroId);
  const high = elite ? ((elite.items[item.className]?.matches ?? 0) + all * ELITE_SHRINK) / (elite.matches + ELITE_SHRINK) : 0;
  return Math.max(all, high);
}

/** Raridade de 0 (comum) a 1 (quase ninguém compra), na escala do log da taxa de compra. */
export function rarity(rate: number): number {
  if (rate >= COMMON_PICK) return 0;
  return Math.min(1, Math.log(COMMON_PICK / Math.max(rate, RARE_PICK)) / Math.log(COMMON_PICK / RARE_PICK));
}

/** Desconto (log da pontuação) de cada item da loja com o herói. Vazio sem estatísticas ou com peso 0. */
export function usageCosts(data: GameData, hero: Hero, weight: number): Map<string, number> {
  const out = new Map<string, number>();
  if (weight <= 0) return out;
  for (const item of data.items) {
    const rate = usageRate(data, hero.id, item);
    if (rate === null) return out;
    const prior = wpaPrior(data, hero.id, item);
    const relief = prior && prior.shrunk > 0 ? GOOD_WPA_RELIEF : 1;
    const cost = (weight * rarity(rate) * relief * item.cost) / 1000;
    if (cost > 0) out.set(item.className, cost);
  }
  return out;
}
