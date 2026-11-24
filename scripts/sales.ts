/**
 * Como os jogadores vendem itens, medido em partidas reais do deadlock-api.com.
 * Grava data/snapshot/sales.json; o formato e as regras estão em src/meta/sales.ts.
 *
 *   npm run sales                      baixa o que falta e recalcula
 *   npm run sales -- --matches 20000   quantas partidas usar (padrão 20.000)
 *   npm run sales -- --days 14         só partidas dos últimos N dias (padrão 14)
 *   npm run sales -- --offline         só recalcula com o que já está em data/raw/sales
 *   npm run sales -- --refresh         descarta as páginas guardadas e baixa de novo (depois de um patch)
 *
 * Também grava a evidência das teorias "late-swap" em data/snapshot/theories.json.
 *
 * As páginas (500 partidas) ficam em data/raw/sales/page-*.json, separadas das do
 * wpa: aqui vem também quando cada item saiu do inventário.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../src/data/load.ts";
import type { Theory } from "../src/knowledge/theories.ts";
import { measureSales, swapEvidence, type SaleMatch } from "../src/meta/sales.ts";

const API = "https://api.deadlock-api.com/v1/matches/metadata";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = join(root, "data", "raw", "sales");
const args = process.argv.slice(2);
const arg = (name: string, fallback: number) => {
  const i = args.indexOf(name);
  const v = i >= 0 ? Number(args[i + 1]) : fallback;
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${name} precisa ser um número positivo.`);
  return v;
};
const TARGET = arg("--matches", 20_000);
const DAYS = arg("--days", 14);
const offline = args.includes("--offline");
const PAGE_SIZE = 500;
const PAUSE_MS = 1500;
const isPage = (f: string) => /^page-\d+\.json$/.test(f);

const data = loadSnapshot();
const shop = new Set(data.items.map((i) => i.id));
mkdirSync(rawDir, { recursive: true });
if (args.includes("--refresh") && !offline) for (const f of readdirSync(rawDir).filter(isPage)) rmSync(join(rawDir, f));

interface ApiMatch {
  match_id: number;
  winning_team: string;
  duration_s: number;
  average_badge: number | null;
  not_scored: boolean | null;
  players: { hero_id: number; team: string; items: { item_id: number; game_time_s: number; sold_time_s: number; flags: number; net_worth_at_buy: number }[] | null }[];
}

function compact(m: ApiMatch): SaleMatch | null {
  if (m.not_scored || m.duration_s < 600 || m.players.length !== 12) return null;
  const team = (t: string) => (t === "Team1" ? 1 : 0);
  return {
    id: m.match_id,
    winner: team(m.winning_team),
    duration: m.duration_s,
    badge: m.average_badge ?? 0,
    players: m.players.map((p) => ({
      hero: p.hero_id,
      team: team(p.team),
      buys: (p.items ?? [])
        .filter((e) => shop.has(e.item_id))
        .sort((a, b) => a.game_time_s - b.game_time_s)
        .map((e) => [e.item_id, e.game_time_s, e.sold_time_s, e.flags, e.net_worth_at_buy]),
    })),
  };
}

const load = (): SaleMatch[] => readdirSync(rawDir).filter(isPage).flatMap((f) => JSON.parse(readFileSync(join(rawDir, f), "utf8")) as SaleMatch[]);
let matches = load();
if (!offline) {
  const since = Math.floor(Date.now() / 86_400_000) * 86400 - DAYS * 86400;
  let maxId = matches.length ? Math.min(...matches.map((m) => m.id)) : undefined;
  while (matches.length < TARGET) {
    const params = new URLSearchParams({
      include_info: "true",
      include_player_items: "true",
      game_mode: "normal",
      limit: String(PAGE_SIZE),
      order_by: "match_id",
      order_direction: "desc",
      min_unix_timestamp: String(since),
      ...(maxId ? { max_match_id: String(maxId - 1) } : {}),
    });
    let page: ApiMatch[] | null = null;
    for (let attempt = 0; attempt < 4 && !page; attempt++) {
      const res = await fetch(`${API}?${params}`).catch(() => null);
      if (res?.ok) page = (await res.json()) as ApiMatch[];
      else if (res && res.status !== 429 && res.status < 500) throw new Error(`metadata: HTTP ${res.status}`);
      else await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
    if (!page) throw new Error("metadata: a API não respondeu depois de 4 tentativas; rode de novo para continuar.");
    if (page.length === 0) break;
    const kept = page.map(compact).filter((m) => m !== null);
    maxId = Math.min(...page.map((m) => m.match_id));
    writeFileSync(join(rawDir, `page-${maxId}.json`), JSON.stringify(kept));
    matches.push(...kept);
    console.log(`${matches.length} partidas`);
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
}
matches = matches.slice(0, TARGET);
if (!matches.length) throw new Error("Sem partidas em data/raw/sales.");

const stats = measureSales(data, matches, data.theories ?? []);
writeFileSync(join(root, "data", "snapshot", "sales.json"), JSON.stringify(stats));
// Evidência das trocas da comunidade, junto da das outras teorias.
const theoryFile = join(root, "data", "snapshot", "theories.json");
if (existsSync(theoryFile)) {
  const theories = JSON.parse(readFileSync(theoryFile, "utf8")) as Theory[];
  for (const t of theories) if (t.kind === "late-swap") t.evidence = swapEvidence(stats, t);
  writeFileSync(theoryFile, JSON.stringify(theories, null, 1));
  const count = (v: string) => theories.filter((t) => t.kind === "late-swap" && t.evidence?.verdict === v).length;
  console.log(`Teorias de troca: ${count("supported")} confirmadas, ${count("unclear")} sem conclusão, ${count("contradicted")} contrariadas.`);
}
console.log(`sales.json: ${stats.matches} partidas, ${Object.keys(stats.heroes).length} heróis, ${stats.swaps.length} trocas de teorias medidas.`);
