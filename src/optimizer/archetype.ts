/**
 * Objetivo "Padrão do arquétipo": mantém a natureza do arquétipo da comunidade em
 * vez de puxar a build para o que o motor acha mais forte.
 *
 * A natureza é medida pelo que os itens do arquétipo fazem com o herói: quanto,
 * juntos, aumentam o dano físico (arma, procs de bala, melee), o dano de spirit e a
 * vida efetiva, cada um relativo ao herói sem itens. Esses ganhos viram os pesos
 * do objetivo. O slot do item não serve: Spirit Rend é slot de arma, mas é um item
 * de spirit. Com o mesmo piso de defesa da "Otimizada", para a build não virar papel.
 */
import type { GameData, Item } from "../data/types.ts";
import { evaluateBuild } from "../engine/index.ts";
import { computeMetrics, DEFAULT_METRIC_OPTIONS, OBJECTIVES, type Weights } from "./metrics.ts";

export function archetypeWeights(data: GameData, hero: string, items: Item[], souls: number): Weights {
  if (!items.length) return OBJECTIVES.optimized;
  // Mesmo tempo ativo dos efeitos condicionais que o otimizador usa.
  const uptime = DEFAULT_METRIC_OPTIONS.uptime;
  const base = computeMetrics(evaluateBuild(data, { hero, souls, items: [], uptime }));
  const with_ = computeMetrics(evaluateBuild(data, { hero, souls, items: items.map((i) => i.name), uptime }));
  const gain = (key: "gunDps" | "spiritDps" | "ehp") => Math.max(0, with_[key] / Math.max(base[key], 1) - 1);
  const raw = { gunDps: gain("gunDps"), spiritDps: gain("spiritDps"), ehp: gain("ehp") };
  const total = raw.gunDps + raw.spiritDps + raw.ehp;
  if (total <= 0) return OBJECTIVES.optimized;
  const weights: Weights = { ehpFloor: OBJECTIVES.optimized.ehpFloor };
  for (const key of ["gunDps", "spiritDps", "ehp"] as const) if (raw[key] > 0) weights[key] = raw[key] / total;
  return weights;
}
