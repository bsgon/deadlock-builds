/**
 * Compara a build do otimizador com as builds publicadas mais jogadas do herói,
 * medindo as duas no mesmo motor e com o mesmo orçamento de souls.
 */
import type { GameData, Item } from "../data/types.ts";
import { findHero } from "../engine/index.ts";
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
