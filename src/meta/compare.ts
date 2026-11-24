/**
 * Compara a build do otimizador com as builds publicadas mais jogadas do herói,
 * medindo as duas no mesmo motor e com o mesmo orçamento de souls.
 */
import type { GameData, Item } from "../data/types.ts";
import { componentTree, equippedItems, findHero, MAX_ACTIVE_ITEMS, owns } from "../engine/index.ts";
import { SELL_REFUND } from "../engine/rules.ts";
import { optimize, type EvaluationMemo, type OptimizeInput, type OptimizeResult } from "../optimizer/optimize.ts";
import { heroMeta, pickRate, popularAtSouls, type PopularBuild } from "./stats.ts";
import { elitePath } from "./elite.ts";

export { popularAtSouls };

export interface BuildComparison {
  build: PopularBuild;
  /** Itens da build publicada que cabem nos souls e slots, na ordem do autor. */
  items: Item[];
  /** A build publicada medida pelo motor. */
  result: OptimizeResult;
  shared: Item[];
  onlyApp: Item[];
  onlyPopular: Item[];
  winrate: number;
}

export function compareWithPopular(data: GameData, app: OptimizeResult, input: OptimizeInput, top = 3): BuildComparison[] {
  const meta = heroMeta(data, findHero(data, input.hero).id);
  return meta ? compareBuilds(data, app, input, meta.builds.slice(0, top)) : [];
}

/** O caminho de itens do elo alto medido como as builds publicadas (null sem dados ou sem itens que caibam). */
export function compareWithElite(data: GameData, app: OptimizeResult, input: OptimizeInput): BuildComparison | null {
  const path = elitePath(data, findHero(data, input.hero).id);
  return path ? (compareBuilds(data, app, input, [path])[0] ?? null) : null;
}

/**
 * A build publicada levada até os souls finais: os itens dela, depois os opcionais e
 * depois os mais comprados do herói. Com os slots cheios, um tier 3 ou 4 entra no lugar
 * do item mais barato, vendido pela metade. Sem isso a comparação põe uma build de
 * 30 mil souls contra uma de 50 mil.
 */
export function completeBuild(data: GameData, heroId: number, build: PopularBuild, souls: number, slots: number): { items: Item[]; spent: number; filled: Item[] } {
  const byClass = new Map(data.items.map((i) => [i.className, i]));
  const cost = (items: Item[]) => items.reduce((sum, i) => sum + i.cost, 0);
  let owned = popularAtSouls(data, build, souls, slots);
  const core = new Set(build.core);
  let spent = cost(owned);
  const popular = Object.entries(heroMeta(data, heroId)?.items ?? {})
    .sort((a, b) => b[1].matches - a[1].matches)
    .map(([cls]) => cls);
  const sold = new Set<string>();
  for (const cls of [...build.core, ...build.optional, ...popular]) {
    const item = byClass.get(cls);
    if (!item || item.tier > 4 || sold.has(cls) || owns(data, owned, item)) continue;
    let next = equippedItems(data, [...owned, item]);
    let pay = cost(next) - cost(owned);
    let victim: Item | null = null;
    if (next.length > slots) {
      if (item.tier < 3) continue;
      const tree = componentTree(data, item);
      victim = owned.filter((i) => !tree.has(i.className) && i.tier < item.tier).sort((a, b) => a.cost - b.cost)[0] ?? null;
      if (!victim) continue;
      next = equippedItems(data, [...owned.filter((i) => i !== victim), item]);
      pay = item.cost - Math.round(victim.cost * SELL_REFUND);
    }
    if (next.length > slots || spent + pay > souls || next.filter((i) => i.isActive).length > MAX_ACTIVE_ITEMS) continue;
    if (victim) for (const c of [victim.className, ...componentTree(data, victim)]) sold.add(c);
    owned = next;
    spent += pay;
  }
  return { items: owned, spent, filled: owned.filter((i) => !core.has(i.className)) };
}

/** A build mais jogada do herói (ou, sem builds publicadas, o caminho do elo alto), completa até os souls finais. */
export interface ReferenceBuild {
  source: "popular" | "elite";
  build: PopularBuild;
  items: Item[];
  /** Itens que não são da build publicada: completam os slots. */
  filled: Item[];
  spent: number;
  metrics: OptimizeResult["metrics"];
}

export function referenceBuild(data: GameData, input: OptimizeInput): ReferenceBuild | null {
  const heroId = findHero(data, input.hero).id;
  const popular = heroMeta(data, heroId)?.builds[0];
  const build = popular ?? elitePath(data, heroId);
  if (!build) return null;
  const { items, spent, filled } = completeBuild(data, heroId, build, input.souls, input.itemSlots ?? 9);
  if (items.length === 0) return null;
  const { metrics } = optimize(data, { ...input, required: items.map((i) => i.className), banned: [], fixedItems: true, explain: false });
  return { source: popular ? "popular" : "elite", build, items, filled, spent, metrics };
}

export function compareBuilds(data: GameData, app: OptimizeResult, input: OptimizeInput, builds: PopularBuild[], memo: EvaluationMemo = new Map()): BuildComparison[] {
  const appClasses = new Set(app.items.map((i) => i.className));
  // As builds são medidas no mesmo contexto: a build sem itens e os upgrades se repetem.
  return builds.flatMap((build) => {
    const items = popularAtSouls(data, build, input.souls, input.itemSlots ?? 9);
    if (items.length === 0) return [];
    const result = optimize(data, { ...input, required: items.map((i) => i.className), banned: [], fixedItems: true }, memo);
    const theirs = new Set(items.map((i) => i.className));
    return [
      {
        build,
        items,
        result,
        shared: app.items.filter((i) => theirs.has(i.className)),
        onlyApp: app.items.filter((i) => !theirs.has(i.className)),
        onlyPopular: items.filter((i) => !appClasses.has(i.className)),
        winrate: build.wins / Math.max(1, build.matches),
      },
    ];
  });
}

/** Fração das partidas do herói em que cada item da build é comprado (null sem dados). */
export function itemPickRates(data: GameData, heroId: number, items: Item[]): Map<string, number | null> {
  const meta = heroMeta(data, heroId);
  return new Map(items.map((i) => [i.className, meta ? pickRate(meta, i) : null]));
}
