/**
 * Confere uma ordem de compra pelas regras da loja: souls disponíveis no
 * momento, custo incremental de upgrade, consumo do componente, venda pela
 * metade, slots, limite de ativos, item repetido e pontos de habilidade.
 */
import type { GameData, Item } from "../data/types.ts";
import { abilityPointsSpent, componentTree, equippedItems, MAX_ACTIVE_ITEMS, owns, progressionFromSouls } from "../engine/index.ts";
import { SELL_REFUND } from "../engine/rules.ts";
import type { OptimizeResult } from "./optimize.ts";

export interface RouteIssue {
  step: number;
  item: string;
  problem: string;
}

/** Fases da partida pelo minuto médio da compra. */
export type Phase = "início" | "meio" | "fim";
export const phaseOf = (minute: number): Phase => (minute < 15 ? "início" : minute < 30 ? "meio" : "fim");

export function validateRoute(data: GameData, result: OptimizeResult, slots: number): RouteIssue[] {
  const issues: RouteIssue[] = [];
  let owned: Item[] = [];
  let earned = 0;
  const cost = (items: Item[]) => items.reduce((s, i) => s + i.cost, 0);
  result.order.forEach((step, i) => {
    const at = (problem: string) => issues.push({ step: i + 1, item: step.item.name, problem });
    if (owns(data, owned, step.item)) at("item já está no inventário");
    if (step.sold && !owned.includes(step.sold)) at(`vende ${step.sold.name}, que não está no inventário`);
    if (step.upgradeFrom && !owned.includes(step.upgradeFrom)) at(`melhora ${step.upgradeFrom.name}, que não está no inventário`);
    const base = step.sold ? owned.filter((o) => o !== step.sold) : owned;
    const next = equippedItems(data, [...base, step.item]);
    // Upgrade consome o componente: ele sai do inventário.
    for (const c of componentTree(data, step.item)) if (next.some((n) => n.className === c)) at(`componente ${c} continua no inventário depois do upgrade`);
    const refund = step.sold ? Math.round(step.sold.cost * SELL_REFUND) : 0;
    const pay = cost(next) - cost(owned) + (step.sold ? step.sold.cost - refund : 0);
    if (Math.abs(pay - step.cost) > 1) at(`custo ${step.cost} diferente do incremental ${pay}`);
    if (step.earned < earned) at("souls ganhos voltaram para trás");
    if (step.earned < earned + Math.max(0, pay) - 1) at(`faltam souls: precisa de ${earned + pay}, tem ${step.earned}`);
    if (step.earned > result.souls) at("compra depois dos souls da build");
    if (next.length > slots) at(`${next.length} itens para ${slots} slots`);
    if (next.filter((x) => x.isActive).length > MAX_ACTIVE_ITEMS) at(`mais de ${MAX_ACTIVE_ITEMS} ativos`);
    owned = next;
    earned = step.earned;
  });
  const points = progressionFromSouls(data.shared, result.souls).abilityPoints;
  if (abilityPointsSpent(result.abilityTiers) > points) issues.push({ step: 0, item: "habilidades", problem: `upgrades custam ${abilityPointsSpent(result.abilityTiers)} pontos, o nível dá ${points}` });
  return issues;
}
