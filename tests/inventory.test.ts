import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { componentTree, equippedItems, evaluateBuild, findItem } from "../src/engine/index.ts";
import { heroMeta, popularAtSouls } from "../src/meta/stats.ts";
import { optimize } from "../src/optimizer/optimize.ts";

const data = loadSnapshot();

/** Componentes que ficam no inventário junto de um upgrade que já os contém. */
const nested = (items: { className: string }[]) =>
  items.filter((c) => items.some((o) => o.className !== c.className && componentTree(data, findItem(data, o.className)).has(c.className)));

describe("inventário sem itens repetidos", () => {
  it("componentTree segue os componentes em qualquer nível", () => {
    const deep = data.items.find((i) => i.components.some((c) => (data.items.find((x) => x.className === c)?.components.length ?? 0) > 0));
    expect(deep).toBeDefined();
    const middle = data.items.find((x) => x.className === deep!.components.find((c) => (data.items.find((y) => y.className === c)?.components.length ?? 0) > 0))!;
    for (const c of middle.components) expect(componentTree(data, deep!).has(c)).toBe(true);
  });

  it("equippedItems tira cópias e componentes de 2º nível", () => {
    const deep = data.items.find((i) => i.components.some((c) => (data.items.find((x) => x.className === c)?.components.length ?? 0) > 0))!;
    const bottom = [...componentTree(data, deep)].map((c) => findItem(data, c)).find((i) => !deep.components.includes(i.className))!;
    const list = equippedItems(data, [deep, bottom, deep]);
    expect(list.map((i) => i.className)).toEqual([deep.className]);
  });

  it("o motor conta um item repetido uma vez só e avisa", () => {
    const r = evaluateBuild(data, { hero: "Haze", souls: 20000, items: ["Extra Spirit", "Extra Spirit"] });
    expect(r.items).toHaveLength(1);
    expect(r.spending.total).toBe(findItem(data, "Extra Spirit").cost);
    expect(r.warnings.some((w) => w.includes("repetidos"))).toBe(true);
  });

  it.each(["Haze", "Abrams", "Apollo", "Celeste", "Seven"])("%s: nenhuma compra se repete e nada fica duplicado", (hero) => {
    for (const objective of ["optimized", "dps", "spirit", "sustain"] as const) {
      for (const mode of ["progressive", "final"] as const) {
        const r = optimize(data, { hero, objective, souls: 45000, mode });
        const bought = r.order.map((s) => s.item.className);
        expect(new Set(bought).size, `${objective}/${mode}`).toBe(bought.length);
        const inv = r.items.map((i) => i.className);
        expect(new Set(inv).size).toBe(inv.length);
        expect(nested(r.items)).toEqual([]);
      }
    }
  }, 120_000);

  it("builds publicadas cortadas nos souls não repetem itens", () => {
    for (const id of Object.keys(data.stats?.heroes ?? {})) {
      for (const build of heroMeta(data, Number(id))?.builds ?? []) {
        const items = popularAtSouls(data, build, 45000, 12);
        expect(new Set(items.map((i) => i.className)).size).toBe(items.length);
        expect(nested(items)).toEqual([]);
      }
    }
  });
});
