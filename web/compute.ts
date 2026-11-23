/**
 * Cálculo pesado da aba "Montar build": otimização, jogadas simuladas, trocas
 * situacionais e comparação com as builds publicadas. Roda no Web Worker
 * (optimize.worker.ts) e, se o navegador não deixar criar o worker, na thread
 * principal (build-client.ts). O resultado só tem dados (sem funções), para
 * passar por postMessage.
 */
import type { GameData, Item } from "../src/data/types.ts";
import { findHero } from "../src/engine/index.ts";
import { buildPlay, situationalOptions, type Situational } from "../src/combat/explain.ts";
import type { PlanId, PlayReport } from "../src/combat/value.ts";
import { compareWithElite, compareWithPopular, type BuildComparison } from "../src/meta/compare.ts";
import { heroMeta } from "../src/meta/stats.ts";
import { optimize, type OptimizeInput, type OptimizeResult } from "../src/optimizer/optimize.ts";
import { validateRoute, type RouteIssue } from "../src/optimizer/route.ts";

export interface BuildPayload {
  result: OptimizeResult;
  plan: PlanId;
  /** Jogadas da build final por tipo de luta. */
  scenarios: PlayReport["scenarios"];
  /** Trocas por tipo de luta (só no plano de controle). */
  situational: Situational[];
  /** Regras da loja que a rota quebra. */
  issues: RouteIssue[];
  /** Builds publicadas medidas pelo motor; null quando o herói não tem estatísticas. */
  comparisons: BuildComparison[] | null;
  /** Caminho de itens do elo alto medido pelo motor; null sem elite.json ou sem itens que caibam. */
  elite: BuildComparison | null;
}

export function computeBuild(data: GameData, input: OptimizeInput): BuildPayload {
  const result = optimize(data, input);
  const plan: PlanId = result.weights.play ? "control" : "damage";
  const ctx = { hero: result.hero, souls: result.souls, abilityTiers: result.abilityTiers, itemSlots: input.itemSlots, uptime: input.metric?.uptime, plan, ...(input.fights ? { fights: input.fights } : {}) };
  const classes = result.items.map((i) => i.className);
  const { report } = buildPlay(data, ctx, classes);
  const situational = plan === "control" ? situationalOptions(data, ctx, classes, data.items.filter((i) => i.isActive && i.tier <= 4 && i.cost <= result.souls / 4)) : [];
  const issues = validateRoute(data, result, input.itemSlots ?? 9);
  const comparisons = heroMeta(data, findHero(data, input.hero).id) ? compareWithPopular(data, result, input) : null;
  const elite = compareWithElite(data, result, input);
  return { result, plan, scenarios: report.scenarios, situational, issues, comparisons, elite };
}

/** Os mesmos dados sem os ícones (na página publicada são data URIs: pesam e o worker não desenha nada). */
export function withoutImages(data: GameData): GameData {
  const strip = <T extends { image: string | null }>(list: T[]): T[] => list.map((x) => ({ ...x, image: null }));
  return { ...data, heroes: strip(data.heroes), items: strip(data.items), abilities: strip(data.abilities) };
}

/**
 * Troca, no resultado que veio do worker, cada cópia de item pelo item de `data`
 * (com o ícone). A cópia do structured clone preserva quem aponta para quem
 * dentro da mensagem, e a troca mantém isso: dois ponteiros para o mesmo item
 * continuam iguais (step.upgradeFrom === outro step.item).
 */
export function relinkItems<T>(value: T, items: Item[]): T {
  const byClass = new Map(items.map((i) => [i.className, i]));
  const seen = new WeakSet<object>();
  const canonical = (x: unknown): Item | undefined => {
    if (typeof x !== "object" || x === null || Array.isArray(x)) return undefined;
    const o = x as Partial<Item>;
    if (typeof o.className !== "string" || !("cost" in o) || !("tier" in o) || !("slot" in o)) return undefined;
    return byClass.get(o.className);
  };
  const walk = (node: unknown): void => {
    if (typeof node !== "object" || node === null || seen.has(node)) return;
    seen.add(node);
    if (node instanceof Map || node instanceof Set) return;
    const record = node as Record<string | number, unknown>;
    for (const key of Object.keys(record)) {
      const child = record[key];
      const item = canonical(child);
      if (item) record[key] = item;
      else walk(child);
    }
  };
  walk(value);
  return value;
}
