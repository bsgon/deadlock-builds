/**
 * Vitória acima do esperado por compra ("WPA"), a partir de partidas reais do
 * deadlock-api.com (/v1/matches/metadata com as compras de cada jogador).
 * Grava data/snapshot/wpa.json; o método está em src/meta/wpa.ts.
 *
 *   npm run wpa                          baixa o que falta e recalcula
 *   npm run wpa -- --matches 20000       quantas partidas usar (padrão 20.000)
 *   npm run wpa -- --days 14             só partidas dos últimos N dias (padrão 14)
 *   npm run wpa -- --offline             só recalcula com o que já está em data/raw/wpa
 *   npm run wpa -- --refresh             descarta as partidas guardadas e baixa de novo (depois de um patch)
 *
 * Cada página (500 partidas, ~27 MB da API) é compactada e guardada em
 * data/raw/wpa/; rodar de novo continua de onde parou. Uma partida em cada cinco
 * fica fora do ajuste do modelo para medir a calibração.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../src/data/load.ts";
import { addPurchase, fitLogistic, purchaseResiduals, trainingSet, winProbability, type CompactMatch, type WpaCell, type WpaStats } from "../src/meta/wpa.ts";

const API = "https://api.deadlock-api.com/v1/matches/metadata";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = join(root, "data", "raw", "wpa");
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
const refresh = args.includes("--refresh");
if (offline && refresh) throw new Error("--offline e --refresh não combinam.");
const PAGE_SIZE = 500;
const PAUSE_MS = 1500;

const data = loadSnapshot();
// Só itens de loja (tier 1 a 4); os ids de habilidade também aparecem na lista de compras.
const shopItem = new Map(data.items.filter((i) => i.tier >= 1 && i.tier <= 4).map((i) => [i.id, i]));
const since = Math.floor(Date.now() / 86_400_000) * 86400 - DAYS * 86400;
mkdirSync(rawDir, { recursive: true });
// Só as páginas que este script grava (page-*.json) são descartadas.
if (refresh) for (const f of readdirSync(rawDir).filter((f) => /^page-\d+\.json$/.test(f))) rmSync(join(rawDir, f));

interface ApiItem {
  game_time_s: number;
  item_id: number;
  net_worth_at_buy: number;
}
interface ApiMatch {
  match_id: number;
  start_time: number;
  winning_team: string;
  duration_s: number;
  not_scored: boolean | null;
  players: { hero_id: number; team: string; items: ApiItem[] | null }[];
}

const teamIndex = (t: string) => (t === "Team1" ? 1 : 0);

function compact(m: ApiMatch): CompactMatch | null {
  if (m.not_scored || m.duration_s < 600 || m.players.length !== 12) return null;
  return {
    id: m.match_id,
    winner: teamIndex(m.winning_team),
    duration: m.duration_s,
    players: m.players.map((p) => {
      const events = [...(p.items ?? [])].sort((a, b) => a.game_time_s - b.game_time_s);
      const t: number[] = [];
      const nw: number[] = [];
      for (const e of events) {
        if (t.length && t[t.length - 1] === e.game_time_s) nw[nw.length - 1] = e.net_worth_at_buy;
        else {
          t.push(e.game_time_s);
          nw.push(e.net_worth_at_buy);
        }
      }
      const seen = new Set<number>();
      const buys: [number, number][] = [];
      for (const e of events) {
        if (!shopItem.has(e.item_id) || seen.has(e.item_id)) continue;
        seen.add(e.item_id);
        buys.push([e.game_time_s, e.item_id]);
      }
      return { hero: p.hero_id, team: teamIndex(p.team), t, nw, buys };
    }),
  };
}

function loadPages(): CompactMatch[] {
  const out: CompactMatch[] = [];
  for (const f of readdirSync(rawDir).filter((f) => f.endsWith(".json"))) out.push(...(JSON.parse(readFileSync(join(rawDir, f), "utf8")) as CompactMatch[]));
  return out;
}

let matches = loadPages().filter((m) => m.id > 0);
if (!offline && matches.length < TARGET) {
  // Continua abaixo da partida mais antiga já baixada.
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
      const res = await fetch(`${API}?${params}`);
      if (res.ok) page = (await res.json()) as ApiMatch[];
      else if (res.status !== 429 && res.status < 500) throw new Error(`metadata: HTTP ${res.status}`);
      else await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
    if (!page) throw new Error("metadata: a API não respondeu depois de 4 tentativas; rode de novo para continuar.");
    if (page.length === 0) {
      console.log(`Sem mais partidas nos últimos ${DAYS} dias.`);
      break;
    }
    const kept = page.map(compact).filter((m): m is CompactMatch => m !== null);
    maxId = Math.min(...page.map((m) => m.match_id));
    writeFileSync(join(rawDir, `page-${maxId}.json`), JSON.stringify(kept));
    matches.push(...kept);
    console.log(`${matches.length} partidas (${kept.length} desta página)`);
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
}
matches = matches.sort((a, b) => b.id - a.id).slice(0, TARGET);
if (matches.length < 1000) throw new Error(`Só ${matches.length} partidas: pouco para ajustar o modelo.`);

// Modelo: ajusta em 4/5 das partidas e mede nas restantes.
const train = matches.filter((m) => m.id % 5 !== 0);
const test = matches.filter((m) => m.id % 5 === 0);
const fit = trainingSet(train);
const coef = fitLogistic(fit.xs, fit.ys);
const check = trainingSet(test);
let brier = 0;
let logLoss = 0;
const bins = Array.from({ length: 10 }, () => [0, 0, 0]); // [n, Σp, Σy]
check.xs.forEach((x, i) => {
  const p = Math.min(1 - 1e-6, Math.max(1e-6, winProbability(coef, x)));
  const y = check.ys[i]!;
  brier += (p - y) ** 2;
  logLoss -= y * Math.log(p) + (1 - y) * Math.log(1 - p);
  const b = bins[Math.min(9, Math.floor(p * 10))]!;
  b[0]! += 1;
  b[1]! += p;
  b[2]! += y;
});
brier /= check.xs.length;
logLoss /= check.xs.length;
console.log(`\nModelo: coeficientes ${coef.map((c) => c.toFixed(3)).join(", ")}`);
console.log(`Fora do ajuste (${test.length} partidas, ${check.xs.length} estados): Brier ${brier.toFixed(4)} (chute 0,25), log loss ${logLoss.toFixed(4)} (chute 0,693)`);
console.log(`Calibração (previsto → observado): ${bins.filter((b) => b[0]! > 200).map((b) => `${((b[1]! / b[0]!) * 100).toFixed(0)}→${((b[2]! / b[0]!) * 100).toFixed(0)}%`).join("  ")}`);

const heroes: Record<string, Record<string, WpaCell>> = {};
let purchases = 0;
for (const m of matches) {
  purchaseResiduals(m, coef, (hero, itemId, residual, p, seconds) => {
    const item = shopItem.get(itemId);
    if (!item) return;
    addPurchase((heroes[String(hero)] ??= {}), item.className, residual, p, seconds);
    purchases++;
  });
}
// Arredonda para o arquivo ficar pequeno (contagens inteiras, somas com 4 casas).
for (const cells of Object.values(heroes)) for (const c of Object.values(cells)) for (let i = 0; i < c.length; i++) c[i] = Math.round(c[i]! * 1e4) / 1e4;

const out: WpaStats = {
  fetchedAt: new Date().toISOString(),
  days: DAYS,
  matches: matches.length,
  purchases,
  coef: coef.map((c) => Math.round(c * 1e4) / 1e4),
  brier: Math.round(brier * 1e4) / 1e4,
  logLoss: Math.round(logLoss * 1e4) / 1e4,
  heroes,
};
writeFileSync(join(root, "data", "snapshot", "wpa.json"), JSON.stringify(out));
const known = new Set(data.heroes.map((h) => String(h.id)));
console.log(`\nGravado data/snapshot/wpa.json: ${matches.length} partidas, ${purchases} compras, ${Object.keys(heroes).filter((h) => known.has(h)).length} heróis.`);
