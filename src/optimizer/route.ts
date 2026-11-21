/**
 * Confere uma ordem de compra pelas regras da loja: souls disponíveis no
 * momento, custo incremental de upgrade, consumo do componente, venda pela
 * metade, slots, limite de ativos, item repetido e pontos de habilidade.
 */
import type { GameData, Item } from "../data/types.ts";
import { abilityPointsSpent, componentTree, equippedItems, MAX_ACTIVE_ITEMS, owns, progressionFromSouls } from "../engine/index.ts";
import { SELL_REFUND } from "../engine/rules.ts";
import { tr } from "../i18n.ts";
import type { OptimizeResult } from "./optimize.ts";

export interface RouteIssue {
  step: number;
  item: string;
  problem: string;
}

/** Fases da partida pelo minuto médio da compra. */
export type Phase = "início" | "meio" | "fim";
export const phaseOf = (minute: number): Phase => (minute < 15 ? "início" : minute < 30 ? "meio" : "fim");
/**
 * Fase para exibir: em português igual a `phaseOf`; em inglês "early"/"mid"/"late"
 * (para "Early game" etc.). `phaseOf` continua em português porque o valor é comparado.
 */
export const phaseLabel = (minute: number): string => {
  const phase = phaseOf(minute);
  return tr(phase, phase === "início" ? "early" : phase === "meio" ? "mid" : "late");
};

export function validateRoute(data: GameData, result: OptimizeResult, slots: number): RouteIssue[] {
  const issues: RouteIssue[] = [];
  let owned: Item[] = [];
  let earned = 0;
  const cost = (items: Item[]) => items.reduce((s, i) => s + i.cost, 0);
  result.order.forEach((step, i) => {
    const at = (problem: string) => issues.push({ step: i + 1, item: step.item.name, problem });
    if (owns(data, owned, step.item)) at(tr("item já está no inventário", "item is already in the inventory"));
    if (step.sold && !owned.includes(step.sold)) at(tr(`vende ${step.sold.name}, que não está no inventário`, `sells ${step.sold.name}, which is not in the inventory`));
    if (step.upgradeFrom && !owned.includes(step.upgradeFrom)) at(tr(`melhora ${step.upgradeFrom.name}, que não está no inventário`, `upgrades ${step.upgradeFrom.name}, which is not in the inventory`));
    const base = step.sold ? owned.filter((o) => o !== step.sold) : owned;
    const next = equippedItems(data, [...base, step.item]);
    // Upgrade consome o componente: ele sai do inventário.
    for (const c of componentTree(data, step.item)) if (next.some((n) => n.className === c)) at(tr(`componente ${c} continua no inventário depois do upgrade`, `component ${c} is still in the inventory after the upgrade`));
    const refund = step.sold ? Math.round(step.sold.cost * SELL_REFUND) : 0;
    const pay = cost(next) - cost(owned) + (step.sold ? step.sold.cost - refund : 0);
    if (Math.abs(pay - step.cost) > 1) at(tr(`custo ${step.cost} diferente do incremental ${pay}`, `cost ${step.cost} differs from the incremental ${pay}`));
    if (step.earned < earned) at(tr("souls ganhos voltaram para trás", "earned souls went backwards"));
    if (step.earned < earned + Math.max(0, pay) - 1) at(tr(`faltam souls: precisa de ${earned + pay}, tem ${step.earned}`, `not enough souls: needs ${earned + pay}, has ${step.earned}`));
    if (step.earned > result.souls) at(tr("compra depois dos souls da build", "purchase after the build's souls"));
    if (next.length > slots) at(tr(`${next.length} itens para ${slots} slots`, `${next.length} items for ${slots} slots`));
    if (next.filter((x) => x.isActive).length > MAX_ACTIVE_ITEMS) at(tr(`mais de ${MAX_ACTIVE_ITEMS} ativos`, `more than ${MAX_ACTIVE_ITEMS} actives`));
    owned = next;
    earned = step.earned;
  });
  const points = progressionFromSouls(data.shared, result.souls).abilityPoints;
  if (abilityPointsSpent(result.abilityTiers) > points) issues.push({ step: 0, item: tr("habilidades", "abilities"), problem: tr(`upgrades custam ${abilityPointsSpent(result.abilityTiers)} pontos, o nível dá ${points}`, `upgrades cost ${abilityPointsSpent(result.abilityTiers)} points, the level gives ${points}`) });
  return issues;
}
