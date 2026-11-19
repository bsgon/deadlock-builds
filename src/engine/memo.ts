/**
 * Apoio a caches de cálculos puros. Muitas contas por item dependem só das
 * propriedades resolvidas do item (que vêm de um cache: mesmo objeto para a mesma
 * fonte e os mesmos stats) e de alguns números da build. `contextId` dá um número
 * curto para cada combinação desses números; com ele, o resultado fica guardado em
 * `WeakMap<propriedades, Map<contexto, resultado>>` sem montar uma chave longa por item.
 */

const ids = new Map<string, number>();
let next = 0;
const CONTEXT_LIMIT = 50000;

/**
 * Número da combinação de valores (o mesmo para valores iguais). Os números nunca se
 * repetem, então limpar a tabela só faz combinações antigas ganharem número novo.
 */
export function contextId(values: readonly (number | string | boolean)[]): number {
  const key = values.join("|");
  let id = ids.get(key);
  if (id === undefined) {
    if (ids.size >= CONTEXT_LIMIT) ids.clear();
    ids.set(key, (id = next++));
  }
  return id;
}

/** Cache por objeto (propriedades resolvidas, item...) e contexto, com limite por objeto. */
export function memoByObject<K extends object, V>(limit = 256) {
  const cache = new WeakMap<K, Map<number, V>>();
  return (obj: K, context: number, compute: () => V): V => {
    let byContext = cache.get(obj);
    if (!byContext) cache.set(obj, (byContext = new Map()));
    let hit = byContext.get(context);
    if (hit === undefined) {
      if (byContext.size >= limit) byContext.clear();
      byContext.set(context, (hit = compute()));
    }
    return hit;
  };
}
