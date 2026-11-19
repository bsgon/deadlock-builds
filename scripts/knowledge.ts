/**
 * Base de conhecimento de interações (RAG sobre a wiki da comunidade).
 *
 *   npm run knowledge -- candidates [--batches 6] [--out <pasta>]
 *       Monta os trechos candidatos (um item/habilidade citando outro) a partir de
 *       data/raw/wiki e grava lotes batch-N.json para extração.
 *   npm run knowledge -- merge <pasta>
 *       Junta os result-N.json da extração, valida ids e grava
 *       data/snapshot/interactions.json (o que o app usa).
 *   npm run knowledge -- ask "<A>" "<B>"
 *       Mostra o que o corpus diz sobre um par (busca do RAG).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../src/data/load.ts";
import { buildIndex, entitiesOf, loadCorpus, retrievePair, type Chunk } from "../src/knowledge/retrieve.ts";
import type { Interaction } from "../src/knowledge/interactions.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...rest] = process.argv.slice(2);
const option = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

const data = loadSnapshot();
const chunks = buildIndex(data, loadCorpus());
const entities = entitiesOf(data);
const byId = new Map(entities.map((e) => [e.id, e]));
const byName = new Map(entities.map((e) => [e.name.toLowerCase(), e]));

/** Trecho com dono e ao menos uma citação de item ou habilidade: candidato a interação. */
/** Linhas de loja (componentes, preço, tier) citam itens mas não descrevem interação. */
const SHOP_LINE = /Upgrades (From|To|Into)|Its component|is a Tier \d|makes up|Component of|Builds into/i;
/**
 * Seções fora do escopo: "Item Draft" e "Street Brawl" são do modo Brawl; "Items"
 * lista itens da mesma categoria (não interação); "Contents" é o sumário da página.
 */
const SKIP_HEADING = /^(Item Draft|Street Brawl|Items|Contents|Ability Changes)$/i;
const isCandidate = (c: Chunk) =>
  c.owner !== null &&
  !SKIP_HEADING.test(c.heading) &&
  !SHOP_LINE.test(c.text) && c.mentions.some((m) => m.kind !== "hero") && (c.owner.kind !== "hero" || c.mentions.some((m) => m.kind === "item"));

if (command === "candidates") {
  const out = option("out") ?? join(root, "data", "raw", "knowledge");
  const batches = Number(option("batches") ?? 6);
  mkdirSync(out, { recursive: true });
  const list = chunks.filter(isCandidate).map((c, i) => ({
    id: i,
    page: c.page,
    url: c.url,
    heading: c.heading,
    lead: c.lead,
    owner: { id: c.owner!.id, name: c.owner!.name, kind: c.owner!.kind },
    mentions: c.mentions.map((m) => ({ id: m.id, name: m.name, kind: m.kind })),
    text: c.text,
  }));
  // Lotes por página, para o extrator ver o contexto de cada página junto.
  const pages = [...new Set(list.map((c) => c.page))];
  const size = Math.ceil(pages.length / batches);
  for (let b = 0; b < batches; b++) {
    const mine = new Set(pages.slice(b * size, (b + 1) * size));
    writeFileSync(join(out, `batch-${b}.json`), JSON.stringify(list.filter((c) => mine.has(c.page)), null, 1));
  }
  console.log(`${list.length} trechos candidatos em ${pages.length} páginas, ${batches} lotes em ${out}`);
} else if (command === "merge") {
  const dir = rest[0] ?? join(root, "data", "raw", "knowledge");
  const all: Interaction[] = [];
  const problems: string[] = [];
  let skipped = 0;
  for (const file of readdirSync(dir).filter((f) => /^result-\d+\.json$/.test(f))) {
    for (const raw of JSON.parse(readFileSync(join(dir, file), "utf8")) as Interaction[]) {
      const a = byId.get(raw.a) ?? byName.get(String(raw.a).toLowerCase());
      const b = byId.get(raw.b) ?? byName.get(String(raw.b).toLowerCase());
      if (!a || !b || a.id === b.id) {
        problems.push(`${file}: ${raw.a} / ${raw.b}`);
        continue;
      }
      if (!["synergy", "anti"].includes(raw.relation) || ![1, 2, 3].includes(raw.strength)) {
        problems.push(`${file}: relação/força inválida em ${a.name} / ${b.name}`);
        continue;
      }
      // Sem nenhum item no par (habilidade com habilidade), é fato do kit: não ajuda a escolher itens.
      if (a.kind !== "item" && b.kind !== "item") {
        skipped++;
        continue;
      }
      all.push({ ...raw, a: a.id, b: b.id, aName: a.name, bName: b.name });
    }
  }
  // Revisão manual (scripts/knowledge-review.json): remove contra-jogo e erros, corrige relações.
  const review = JSON.parse(readFileSync(join(root, "scripts", "knowledge-review.json"), "utf8")) as {
    remove: Record<string, string>;
    change: Record<string, Pick<Interaction, "relation" | "strength" | "mechanism">>;
  };
  const pairName = (i: Interaction) => [i.aName, i.bName].sort().join(" + ");
  const reviewKey = (k: string) => k.split(" + ").sort().join(" + ");
  const removed = new Set(Object.keys(review.remove).map(reviewKey));
  const changes = new Map(Object.entries(review.change).map(([k, v]) => [reviewKey(k), v]));
  const used = new Set<string>();
  const reviewed = all.flatMap((i) => {
    const key = pairName(i);
    if (removed.has(key)) return (used.add(key), []);
    const change = changes.get(key);
    if (change) used.add(key);
    return [change ? { ...i, ...change } : i];
  });
  const unused = [...removed, ...changes.keys()].filter((k) => !used.has(k));
  if (unused.length) console.log(`Revisão sem par correspondente (confira os nomes): ${unused.join("; ")}`);

  // Um registro por par e relação: fica o mais forte.
  const best = new Map<string, Interaction>();
  for (const i of reviewed) {
    const key = [i.a, i.b].sort().join("|") + `|${i.relation}`;
    const cur = best.get(key);
    if (!cur || i.strength > cur.strength) best.set(key, i);
  }
  const result = [...best.values()].sort((x, y) => y.strength - x.strength || x.aName.localeCompare(y.aName));
  writeFileSync(join(root, "data", "snapshot", "interactions.json"), JSON.stringify(result, null, 1));
  console.log(
    `${result.length} interações gravadas (${all.length + skipped} extraídas; ${skipped} só entre habilidades; ${all.length - reviewed.length} removidas na revisão; ${changes.size} corrigidas; ${problems.length} inválidas).`,
  );
  if (problems.length) console.log(problems.slice(0, 20).join("\n"));
} else if (command === "ask") {
  const [a, b] = rest.map((n) => byName.get(n.toLowerCase()));
  if (!a || !b) throw new Error("Use nomes exatos de itens, habilidades ou heróis.");
  const found = retrievePair(chunks, a.id, b.id);
  console.log(found.length ? found.map((c) => `[${c.page} › ${c.heading}] ${c.text}\n  ${c.url}`).join("\n\n") : "Nada no corpus sobre esse par.");
} else {
  console.log("Uso: knowledge candidates | merge <pasta> | ask \"<A>\" \"<B>\"");
}
if (!existsSync(join(root, "data", "raw", "wiki"))) console.log("Aviso: rode `npm run wiki` antes.");
