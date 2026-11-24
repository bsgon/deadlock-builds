/**
 * Corpus de theorycraft: builds publicadas no navegador de builds do jogo
 * (deadlock-api.com/v1/builds) e notas de patch (/v1/patches).
 *
 *   npm run theory -- fetch [--per-hero 40] [--since 2026-09-29] [--refresh]
 *       Baixa as builds mais favoritadas da semana de cada herói, atualizadas
 *       depois do último grande patch, para data/raw/theory/.
 *   npm run theory -- candidates [--batches 10]
 *       Monta documentos compactos (nome, descrição, categorias com itens,
 *       anotações do autor e prioridade de venda) em lotes para extração.
 *   npm run theory -- check
 *       Confere combos e arquétipos contra partidas reais (winrate juntos vs o melhor item sozinho).
 *   npm run theory -- merge
 *       Junta os result-N.json da extração em data/snapshot/theories.json.
 *
 * Os textos dos autores ficam só locais; o app recebe as teorias com nossas
 * palavras e a referência das builds de origem.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../src/data/load.ts";
import type { Theory } from "../src/knowledge/theories.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "data", "raw", "theory");
const API = "https://api.deadlock-api.com";
const [command, ...rest] = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1]! : fallback;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Partidas mínimas com os itens juntos para tirar conclusão. */
const MIN_EVIDENCE = 300;
/** Juntar os itens ganha pelo menos 1 ponto percentual sobre o melhor item sozinho. */
const SUPPORT_LIFT = 1;
/** Juntar os itens perde 2 pontos ou mais: os dados contrariam a teoria. */
const CONTRADICT_LIFT = -2;
mkdirSync(dir, { recursive: true });
const data = loadSnapshot();

interface ApiMod {
  ability_id: number;
  annotation?: string | null;
  sell_priority?: number | null;
  imbue_target_ability_id?: number | null;
}
interface ApiBuild {
  num_favorites: number;
  num_weekly_favorites: number;
  hero_build: {
    hero_id: number;
    hero_build_id: number;
    name: string;
    description?: string;
    language: number;
    version: number;
    last_updated_timestamp: number;
    details?: { mod_categories?: { name: string; description?: string; optional?: boolean; mods: ApiMod[] }[] };
  };
}

async function get<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, { headers: { "User-Agent": "deadlock-builds-research/0.1" } });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 || res.status >= 500) {
      await sleep(3000 * (attempt + 1));
      continue;
    }
    throw new Error(`${path}: HTTP ${res.status}`);
  }
  throw new Error(`${path}: sem resposta`);
}

if (command === "fetch") {
  const perHero = Number(option("per-hero", "40"));
  const since = Math.floor(new Date(option("since", "2026-09-29")).getTime() / 1000);
  const refresh = rest.includes("--refresh");
  writeFileSync(join(dir, "patches.json"), JSON.stringify(await get<unknown[]>("/v1/patches"), null, 1));
  let total = 0;
  for (const hero of data.heroes) {
    const file = join(dir, `builds-${hero.id}.json`);
    if (!refresh && existsSync(file)) continue;
    const builds = await get<ApiBuild[]>(`/v1/builds?hero_id=${hero.id}&only_latest=true&sort_by=weekly_favorites&limit=${perHero}&min_unix_timestamp=${since}`);
    writeFileSync(file, JSON.stringify(builds, null, 1));
    total += builds.length;
    await sleep(400);
  }
  console.log(`${total} builds baixadas; notas de patch em data/raw/theory/patches.json.`);
} else if (command === "candidates") {
  const batches = Number(option("batches", "10"));
  const byId = new Map(data.items.map((i) => [i.id, i]));
  const docs: { hero: string; heroId: number; buildId: number; favorites: number; doc: string }[] = [];
  for (const hero of data.heroes) {
    const file = join(dir, `builds-${hero.id}.json`);
    if (!existsSync(file)) continue;
    for (const b of JSON.parse(readFileSync(file, "utf8")) as ApiBuild[]) {
      const h = b.hero_build;
      const cats = (h.details?.mod_categories ?? [])
        .map((c) => {
          const items = c.mods
            .map((m) => {
              const item = byId.get(m.ability_id);
              if (!item) return null; // tier 5 (Brawl) ou removido
              const note = m.annotation && !/^Pick Rate/i.test(m.annotation) ? ` — "${m.annotation.replace(/\s+/g, " ").trim()}"` : "";
              const sell = (m.sell_priority ?? 0) > 0 ? ` [vender: prioridade ${m.sell_priority}]` : "";
              return `${item.name}${sell}${note}`;
            })
            .filter(Boolean);
          return items.length ? `## ${c.name}${c.description ? ` (${c.description.replace(/\s+/g, " ").trim()})` : ""}${c.optional ? " [opcional]" : ""}\n- ${items.join("\n- ")}` : "";
        })
        .filter(Boolean);
      if (!cats.length) continue;
      // Build sem nenhum comentário do autor só repete o que as estatísticas já mostram;
      // fica só entre as 10 mais favoritadas do herói (aí ainda serve de arquétipo).
      const commented = (h.description ?? "").trim().length >= 40 || cats.some((c) => c.includes(' — "') || c.includes("[vender"));
      const rank = docs.filter((d) => d.heroId === hero.id).length;
      if (!commented && rank >= 10) continue;
      const doc = [`# ${h.name} (build ${h.hero_build_id}, ${b.num_favorites ?? 0} favoritos, ${b.num_weekly_favorites ?? 0} na semana)`, h.description ? h.description.replace(/\s+/g, " ").trim().slice(0, 1500) : "", ...cats].filter(Boolean).join("\n");
      docs.push({ hero: hero.name, heroId: hero.id, buildId: h.hero_build_id, favorites: b.num_favorites ?? 0, doc });
    }
  }
  // Lotes por herói, para o extrator ver todas as builds do mesmo herói juntas.
  const heroes = [...new Set(docs.map((d) => d.heroId))];
  const size = Math.ceil(heroes.length / batches);
  for (let i = 0; i < batches; i++) {
    const mine = new Set(heroes.slice(i * size, (i + 1) * size));
    writeFileSync(join(dir, `batch-${i}.json`), JSON.stringify(docs.filter((d) => mine.has(d.heroId)), null, 1));
  }
  console.log(`${docs.length} builds em ${heroes.length} heróis, ${batches} lotes em ${dir}`);
} else if (command === "merge") {
  const itemByName = new Map(data.items.map((i) => [i.name.toLowerCase(), i]));
  const heroByName = new Map(data.heroes.map((h) => [h.name.toLowerCase(), h]));
  const all: Theory[] = [];
  const problems: string[] = [];
  for (const file of readdirSync(dir).filter((f) => /^result-\d+\.json$/.test(f))) {
    for (const raw of JSON.parse(readFileSync(join(dir, file), "utf8")) as (Omit<Theory, "items"> & { items: string[] })[]) {
      const hero = heroByName.get(String(raw.hero).toLowerCase());
      const items = raw.items.map((n) => itemByName.get(n.toLowerCase()));
      if (!hero || items.some((i) => !i) || items.length === 0) {
        problems.push(`${file}: ${raw.hero} / ${raw.items.join(", ")}`);
        continue;
      }
      all.push({ ...raw, hero: hero.name, heroId: hero.id, items: items.map((i) => i!.className), itemNames: items.map((i) => i!.name) });
    }
  }
  // Mesma teoria (herói, tipo, itens) vinda de várias builds: soma o apoio.
  const merged = new Map<string, Theory>();
  for (const t of all) {
    const key = `${t.heroId}|${t.kind}|${[...t.items].sort().join(",")}`;
    const cur = merged.get(key);
    if (!cur) merged.set(key, { ...t, builds: [...new Set(t.builds)] });
    else merged.set(key, { ...cur, builds: [...new Set([...cur.builds, ...t.builds])], favorites: cur.favorites + t.favorites });
  }
  const result = [...merged.values()].sort((a, b) => a.hero.localeCompare(b.hero) || b.builds.length - a.builds.length);
  writeFileSync(join(root, "data", "snapshot", "theories.json"), JSON.stringify(result, null, 1));
  console.log(`${result.length} teorias gravadas (${all.length} extraídas; ${problems.length} descartadas).`);
  if (problems.length) console.log(problems.slice(0, 15).join("\n"));
} else if (command === "check") {
  // Combos e arquétipos: winrate das partidas do herói com todos os itens juntos,
  // comparado ao melhor desses itens sozinho (item comprado tarde sempre "ganha mais";
  // a comparação com o item isolado mede o que juntar acrescenta).
  const file = join(root, "data", "snapshot", "theories.json");
  const theories = JSON.parse(readFileSync(file, "utf8")) as Theory[];
  const since = Math.floor(new Date(option("since", "2026-09-29")).getTime() / 1000);
  const byClass = new Map(data.items.map((i) => [i.className, i]));
  let checked = 0;
  for (const t of theories) {
    if ((t.kind !== "combo" && t.kind !== "archetype") || t.items.length < 2 || t.evidence) continue;
    const meta = data.stats?.heroes[String(t.heroId)];
    if (!meta) continue;
    const ids = t.items.map((c) => byClass.get(c)!.id).join(",");
    try {
      const rows = await get<{ wins: number; matches: number }[]>(
        `/v1/analytics/item-permutation-stats?hero_id=${t.heroId}&item_ids=${ids}&min_unix_timestamp=${since}&game_mode=normal`,
      );
      const together = rows[0];
      const singles = t.items.map((c) => meta.items[c]).filter((u) => u && u.matches > 0);
      const best = Math.max(...singles.map((u) => u!.wins / u!.matches));
      if (!together || together.matches === 0 || !Number.isFinite(best)) t.evidence = { verdict: "unclear", lift: 0, matches: together?.matches ?? 0 };
      else {
        const lift = (together.wins / together.matches - best) * 100;
        const verdict = together.matches < MIN_EVIDENCE ? "unclear" : lift >= SUPPORT_LIFT ? "supported" : lift <= CONTRADICT_LIFT ? "contradicted" : "unclear";
        t.evidence = { verdict, lift: Math.round(lift * 10) / 10, matches: together.matches };
      }
      checked++;
    } catch (err) {
      console.log(`${t.hero} / ${t.itemNames.join(" + ")}: ${(err as Error).message}`);
    }
    await sleep(350);
  }
  writeFileSync(file, JSON.stringify(theories, null, 1));
  const count = (v: string) => theories.filter((t) => t.evidence?.verdict === v).length;
  console.log(`${checked} teorias checadas: ${count("supported")} confirmadas, ${count("unclear")} sem conclusão, ${count("contradicted")} contrariadas pelos dados.`);
} else {
  console.log("Uso: theory fetch | candidates | merge | check");
}
