import type { InvestmentStep, Item, Shared, Slot } from "../data/types.ts";
import { ABILITY_UPGRADE_COST } from "./rules.ts";
import { tr } from "../i18n.ts";

export interface Progression {
  level: number;
  /** Boons recebidos (nível - 1). */
  boons: number;
  abilityPoints: number;
  abilityUnlocks: number;
  /** Souls que faltam para o próximo nível (null no nível máximo). */
  soulsToNext: number | null;
}

/** Nível e recursos a partir dos souls acumulados na partida. */
export function progressionFromSouls(shared: Shared, souls: number): Progression {
  let level = 1;
  let abilityPoints = 0;
  let abilityUnlocks = 0;
  let soulsToNext: number | null = null;
  for (const info of shared.levels) {
    if (souls >= info.souls) {
      level = info.level;
      for (const g of info.grants) {
        if (g === "abilityPoint") abilityPoints += 1;
        else abilityUnlocks += 1;
      }
    } else {
      soulsToNext = info.souls - souls;
      break;
    }
  }
  return { level, boons: level - 1, abilityPoints, abilityUnlocks, soulsToNext };
}

/** Souls acumulados necessários para um nível. */
export function soulsForLevel(shared: Shared, level: number): number {
  const info = shared.levels.find((l) => l.level === level);
  if (!info) throw new Error(tr(`Nível ${level} não existe na tabela.`, `Level ${level} is not in the table.`));
  return info.souls;
}

/** Bônus de investimento para um total gasto numa categoria. */
export function investmentBonus(steps: InvestmentStep[], spent: number): number {
  let bonus = 0;
  for (const step of steps) {
    if (spent >= step.souls) bonus = step.bonus;
    else break;
  }
  return bonus;
}

export interface Spending {
  total: number;
  bySlot: Record<Slot, number>;
  bonus: Record<Slot, number>;
}

/**
 * Gasto por categoria. Um item que melhora um componente já inclui o preço
 * do componente no próprio custo, então o componente não é contado de novo.
 */
export function spending(shared: Shared, items: Item[]): Spending {
  const consumed = new Set(items.flatMap((i) => i.components));
  const bySlot: Record<Slot, number> = { weapon: 0, vitality: 0, spirit: 0 };
  for (const item of items) {
    if (consumed.has(item.className)) continue;
    bySlot[item.slot] += item.cost;
  }
  const bonus = {
    weapon: investmentBonus(shared.investment.weapon, bySlot.weapon),
    vitality: investmentBonus(shared.investment.vitality, bySlot.vitality),
    spirit: investmentBonus(shared.investment.spirit, bySlot.spirit),
  };
  return { total: bySlot.weapon + bySlot.vitality + bySlot.spirit, bySlot, bonus };
}

/** Pontos gastos por um plano de upgrades (tiers 0 a 3 por habilidade). */
export function abilityPointsSpent(tiers: number[]): number {
  let total = 0;
  for (const tier of tiers) {
    for (let t = 0; t < tier; t++) total += ABILITY_UPGRADE_COST[t] ?? 0;
  }
  return total;
}
