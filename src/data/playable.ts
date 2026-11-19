/**
 * Itens de tier 5 só existem no modo Brawl (street_brawl), que o projeto não
 * cobre: partidas normais e ranqueadas vão até o tier 4. Eles saem dos dados
 * logo ao carregar, para não aparecer em builds, sinergias ou comparações.
 */
import type { GameData } from "./types.ts";

export const MAX_ITEM_TIER = 4;

export function withoutBrawlItems(data: GameData): GameData {
  return { ...data, items: data.items.filter((i) => i.tier <= MAX_ITEM_TIER) };
}
