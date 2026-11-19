/** Auditoria de cobertura: o que o snapshot traz e o motor ainda não usa. */
import { loadSnapshot } from "../src/data/load.ts";
import { evaluateBuild } from "../src/engine/index.ts";

const data = loadSnapshot();
const count = (list: string[]) => {
  const m = new Map<string, number>();
  for (const k of list) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

console.log(`patch ${data.meta.clientVersion}: ${data.heroes.length} heróis, ${data.items.length} itens`);

console.log("\n== Stats inatos de itens (tipo: nº de itens) ==");
for (const [k, n] of count(data.items.flatMap((i) => Object.keys(i.innate)))) console.log(`  ${k.replace("MODIFIER_VALUE_", "")}: ${n}`);

const noInnate = data.items.filter((i) => Object.keys(i.innate).length === 0);
console.log(`\n== Itens sem nenhum stat inato: ${noInnate.length} ==`);
console.log("  " + noInnate.map((i) => i.name).join(", "));

console.log(`\n== Itens com propriedades condicionais: ${data.items.filter((i) => i.conditional.length > 0).length} ==`);

const unresolved: string[] = [];
for (const hero of data.heroes) {
  const r = evaluateBuild(data, { hero: hero.name, souls: 20000 });
  for (const a of r.abilities) for (const [k, p] of Object.entries(a.properties)) for (const u of p.unresolved) unresolved.push(u);
}
console.log("\n== Escalas de habilidade que o motor não aplica (stat: ocorrências) ==");
for (const [k, n] of count(unresolved)) console.log(`  ${k}: ${n}`);

console.log("\n== Escalas próprias de herói ==");
for (const [k, n] of count(data.heroes.flatMap((h) => h.scaling.map((s) => s.stat)))) console.log(`  ${k}: ${n}`);
