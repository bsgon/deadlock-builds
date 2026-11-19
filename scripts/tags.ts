/**
 * Mostra as etiquetas atribuídas a itens ou ao kit de um herói.
 *
 *   npm run tags                 todos os itens
 *   npm run tags -- "Haze"       kit do herói
 */
import { loadSnapshot } from "../src/data/load.ts";
import { tagAll } from "../src/interactions/tagger.ts";
import type { Node } from "../src/interactions/tags.ts";

const data = loadSnapshot();
const tagged = tagAll(data);

function line(n: Node): string {
  const gives = Object.entries(n.gives).map(([k, w]) => (w === "always" ? k : `${k}?`));
  const wants = Object.entries(n.wants).map(([k, s]) => `${k}:${s.toFixed(1)}`);
  const part = (label: string, list: string[]) => (list.length ? ` ${label}[${list.join(",")}]` : "");
  return `${n.name}:${part("dá", gives)}${part("aplica", n.applies)}${part("causa", n.deals)}${part("gatilho", n.triggers)}${part("quer", wants)}`;
}

const ref = process.argv[2];
if (ref) {
  const hero = data.heroes.find((h) => h.name.toLowerCase() === ref.toLowerCase());
  if (!hero) throw new Error(`Herói não encontrado: ${ref}`);
  for (const n of tagged.kits.get(hero.id) ?? []) console.log(line(n));
} else {
  for (const n of tagged.items) console.log(line(n));
}
