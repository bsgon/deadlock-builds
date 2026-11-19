/**
 * Consulta o grafo de interações.
 *
 *   npm run synergy -- hero "Haze" [categoria]     itens que encaixam no kit (weapon|vitality|spirit)
 *   npm run synergy -- item "Mystic Shot"          parceiros do item e heróis que o aproveitam
 *   npm run synergy -- pair "Mystic Shot" "Mystic Vulnerability"   heróis em que o par funciona
 */
import { loadSnapshot } from "../src/data/load.ts";
import { findHero, findItem } from "../src/engine/index.ts";
import { buildGraph, heroesForItem, heroesForPair, itemsForHero, partnersByTree, topReasons } from "../src/interactions/synergy.ts";

const data = loadSnapshot();
const graph = buildGraph(data);
const [mode, first, second] = process.argv.slice(2);
const TOP = 15;

function usage(): never {
  console.log('Uso: synergy hero "<herói>" [weapon|vitality|spirit] | item "<item>" | pair "<item>" "<item>"');
  process.exit(1);
}

if (mode === "hero" && first) {
  const hero = findHero(data, first);
  const fits = itemsForHero(graph, hero).filter((f) => !second || f.item.slot === second);
  console.log(`Itens que encaixam no kit de ${hero.name}${second ? ` (${second})` : ""} — pontuação heurística:`);
  for (const f of fits.slice(0, TOP)) {
    console.log(`\n${f.score.toFixed(1).padStart(5)}  ${f.item.name} (${f.item.slot}, ${f.item.cost})`);
    for (const r of topReasons(f.links)) console.log(`         - ${r}`);
  }
} else if (mode === "item" && first) {
  const item = findItem(data, first);
  const byTree = partnersByTree(graph, item, 5);
  // Outras árvores primeiro: são as combinações menos óbvias.
  for (const slot of [...(["weapon", "vitality", "spirit"] as const).filter((s) => s !== item.slot), item.slot]) {
    console.log(`\nParceiros de ${item.name} na árvore ${slot}${slot === item.slot ? " (a mesma)" : ""}:`);
    if (byTree[slot].length === 0) console.log("  nenhum");
    for (const p of byTree[slot]) {
      console.log(`${p.score.toFixed(1).padStart(5)}  ${p.item.name} (${p.item.cost})`);
      for (const r of topReasons(p.links, 2)) console.log(`         - ${r}`);
    }
  }
  console.log(`\nHeróis que mais aproveitam ${item.name}:`);
  for (const h of heroesForItem(graph, item).slice(0, 10)) {
    console.log(`${h.score.toFixed(1).padStart(5)}  ${h.hero.name}: ${topReasons(h.links, 1)[0] ?? ""}`);
  }
} else if (mode === "pair" && first && second) {
  const a = findItem(data, first);
  const b = findItem(data, second);
  const fits = heroesForPair(graph, a, b);
  const pair = fits[0]?.pair;
  console.log(`Sinergia entre ${a.name} e ${b.name}: ${pair ? pair.score.toFixed(1) : "0"}`);
  for (const r of topReasons(pair?.links ?? [], 4)) console.log(`  - ${r}`);
  console.log(`\nHeróis em que o par funciona:`);
  for (const f of fits.slice(0, 12)) {
    console.log(`${f.score.toFixed(1).padStart(5)}  ${f.hero.name} (${a.name} ${f.a.score.toFixed(1)}, ${b.name} ${f.b.score.toFixed(1)})`);
    for (const r of [...topReasons(f.a.links, 1), ...topReasons(f.b.links, 1)]) console.log(`         - ${r}`);
  }
} else {
  usage();
}
