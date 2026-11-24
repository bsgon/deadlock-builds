/**
 * Regras de inventário: o jogo não deixa ter dois itens iguais, e um item
 * melhorado absorve os componentes dele em qualquer nível (Boundless Spirit
 * contém Improved Spirit, que contém Extra Spirit). Enquanto o upgrade está no
 * inventário, nenhum desses componentes pode ser comprado de novo.
 */
import type { GameData, Item } from "../data/types.ts";

const treeCache = new WeakMap<GameData, Map<string, Set<string>>>();

/** class_name de todos os componentes do item, em qualquer nível. */
export function componentTree(data: GameData, item: Item): Set<string> {
  let cache = treeCache.get(data);
  if (!cache) treeCache.set(data, (cache = new Map()));
  const hit = cache.get(item.className);
  if (hit) return hit;
  const byClass = new Map(data.items.map((i) => [i.className, i]));
  const tree = new Set<string>();
  const walk = (cls: string) => {
    for (const c of byClass.get(cls)?.components ?? []) {
      if (tree.has(c)) continue;
      tree.add(c);
      walk(c);
    }
  };
  walk(item.className);
  cache.set(item.className, tree);
  return tree;
}

/**
 * Itens que ficam no inventário: tira componentes absorvidos por um upgrade
 * presente (em qualquer nível) e cópias repetidas, mantendo a primeira.
 */
export function equippedItems(data: GameData, items: Item[]): Item[] {
  // Chamada dezenas de milhares de vezes pela busca: compara direto, sem montar conjuntos.
  const trees = items.map((i) => componentTree(data, i)).filter((t) => t.size > 0);
  return items.filter((item, n) => {
    const cls = item.className;
    for (const t of trees) if (t.has(cls)) return false;
    for (let k = 0; k < n; k++) if (items[k]!.className === cls) return false;
    return true;
  });
}

/** True quando o item já está no inventário, sozinho ou dentro de um upgrade. */
export function owns(data: GameData, items: Item[], item: Item): boolean {
  return items.some((i) => i.className === item.className || componentTree(data, i).has(item.className));
}
