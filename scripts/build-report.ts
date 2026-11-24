/**
 * Mede as builds do app: vendas, itens raros, slots e força ao longo da partida.
 *
 *   npm run build-report                      todos os heróis, com o pico de vitality do app
 *   npm run build-report -- Haze Paige        só estes heróis
 *   npm run build-report -- --default-spike   pico de vitality padrão do otimizador (tabelas de docs/plano-builds-v2.md)
 *   npm run build-report -- --plan            modo "plan" do otimizador (padrão: progressiva)
 *   npm run build-report -- --usage=0.03      outro peso do uso real (0 desliga)
 *   npm run build-report -- --json=arquivo    grava também as rotas
 *   npm run build-report -- --download        baixa de novo as partidas dos jogadores
 *
 * Build: Otimizada, 50.000 souls, 12 slots. Os jogadores vêm de data/raw/sales
 * (1.000 partidas recentes e 1.000 de elo alto, com sold_time_s de cada compra).
 *
 * J: força da rota em cada marco de 5 min, pesada pela chance de a partida durar até
 * lá: Σ P(dura ≥ t)·ln(pontuação(t)) / Σ P(dura ≥ t), com piso de defesa fixo.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Item } from "../src/data/types.ts";
import { loadSnapshot } from "../src/data/load.ts";
import { componentTree, equippedItems, findHero, findItem } from "../src/engine/index.ts";
import { VITALITY_SPIKE_SOULS } from "../src/engine/rules.ts";
import { heroElite } from "../src/meta/elite.ts";
import { heroMeta, pickRate, soulsAtMinute, vitalitySpikeOf } from "../src/meta/stats.ts";
import { optimize, type PurchaseStep } from "../src/optimizer/optimize.ts";
import { MIN_HOLD_MINUTES, MIN_SALE_GAIN, routeSales, type Sale } from "../src/optimizer/sales.ts";

const SOULS = 50_000;
const SLOTS = 12;
const LOW_PICK = 0.05;
const GRID = [5, 10, 15, 20, 25, 30, 35, 40];
/** Venda em menos de 45 s conta como desfazer na loja (devolução total). */
const UNDO_SECONDS = 45;

const args = process.argv.slice(2);
const jsonFile = args.find((a) => a.startsWith("--json="))?.slice("--json=".length);
const names = args.filter((a) => !a.startsWith("--"));
const mode = args.includes("--plan") ? ("plan" as const) : ("progressive" as const);
const usageArg = args.find((a) => a.startsWith("--usage="))?.slice("--usage=".length);
const data = loadSnapshot();
const heroes = names.length ? names.map((n) => findHero(data, n)) : data.heroes;
const fmt = (x: number, d = 0) => x.toFixed(d);
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const quantile = (xs: number[], q = 0.5) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * q)] ?? 0;

// --- App -------------------------------------------------------------------

function inventoryAt(order: PurchaseStep[], souls: number): Item[] {
  let owned: Item[] = [];
  for (const s of order) {
    if (s.earned > souls) break;
    owned = equippedItems(data, [...owned.filter((i) => i !== s.sold), s.item]);
  }
  return owned;
}

/** Chance de a partida durar pelo menos `minute`, pelas faixas de duração do herói. */
function survival(heroId: number, minute: number): number {
  const buckets = heroMeta(data, heroId)?.byDuration ?? [];
  const total = buckets.reduce((s, b) => s + b.matches, 0);
  if (!total) return 1;
  let alive = 0;
  for (const b of buckets) {
    const end = b.toMin ?? b.fromMin + 15;
    alive += b.matches * Math.min(1, Math.max(0, (end - minute) / (end - b.fromMin)));
  }
  return alive / total;
}

const sales: (Sale & { hero: string })[] = [];
const finals = new Map<string, number>();
const picks = new Map<string, number[]>();
const slotCounts = new Map<number, number[]>(GRID.map((t) => [t, []]));
const routes: unknown[] = [];
let rare = 0;
let total = 0;
let idle = 0;
let emptySlots = 0;
const js: number[] = [];
const planJs: number[] = [];
const times: number[] = [];
const scores: number[] = [];
const started = Date.now();
for (const hero of heroes) {
  const own = args.includes("--default-spike") ? undefined : vitalitySpikeOf(data, hero.id, VITALITY_SPIKE_SOULS);
  const spike = own === undefined ? undefined : own ? { souls: VITALITY_SPIKE_SOULS, deadline: own.souls } : (false as const);
  const before = performance.now();
  const r = optimize(data, { hero: hero.name, objective: "optimized", souls: SOULS, itemSlots: SLOTS, mode, ...(usageArg === undefined ? {} : { usageWeight: Number(usageArg) }), ...(spike === undefined ? {} : { vitalitySpike: spike }) });
  times.push(performance.now() - before);
  planJs.push(r.routeValue ?? 0);
  sales.push(...routeSales(data, r.order).map((s) => ({ ...s, hero: hero.name })));
  idle += SOULS - r.spent;
  emptySlots += SLOTS - r.items.length;
  scores.push(r.score);
  const meta = heroMeta(data, hero.id);
  const elite = heroElite(data, hero.id);
  for (const i of r.items) {
    const p = meta ? (pickRate(meta, i) ?? 0) : 0;
    const e = elite?.matches ? (elite.items[i.className]?.matches ?? 0) / elite.matches : 0;
    total++;
    if (Math.max(p, e) < LOW_PICK) rare++;
    finals.set(i.name, (finals.get(i.name) ?? 0) + 1);
    picks.set(i.name, [...(picks.get(i.name) ?? []), Math.max(p, e)]);
  }
  let sum = 0;
  let weight = 0;
  for (const t of GRID) {
    const souls = soulsAtMinute(data, hero.id, t);
    const items = inventoryAt(r.order, souls);
    slotCounts.get(t)!.push(items.length);
    const s = optimize(data, { hero: hero.name, objective: "optimized", souls, itemSlots: SLOTS, fixedItems: true, required: items.map((i) => i.className), vitalitySpike: false }).score;
    const w = survival(hero.id, t);
    sum += w * Math.log(Math.max(s, 1e-6));
    weight += w;
  }
  const j = sum / weight;
  js.push(j);
  routes.push({ hero: hero.name, j, routeValue: r.routeValue, score: r.score, spent: r.spent, items: r.items.map((i) => i.name), order: r.order.map((s) => ({ minute: s.minute, item: s.item.name, cost: s.cost, sold: s.sold?.name ?? null })) });
}

console.log(`App: ${heroes.length} heróis, Otimizada, ${SOULS} souls, ${SLOTS} slots (patch ${data.meta.clientVersion})`);
console.log(`  vendas por build            ${fmt(sales.length / heroes.length, 2)}  (${sales.length} no total, ${new Set(sales.map((s) => s.hero)).size} heróis)`);
console.log(`  souls perdidos por build    ${fmt(sales.reduce((a, s) => a + s.loss, 0) / heroes.length)}`);
console.log(`  posse < ${MIN_HOLD_MINUTES} min              ${sales.filter((s) => s.held < MIN_HOLD_MINUTES).length}`);
console.log(`  vende o que entrou por troca ${sales.filter((s) => s.chain).length}`);
console.log(`  trocas com ganho < ${pct(MIN_SALE_GAIN)}       ${sales.filter((s) => s.gain < MIN_SALE_GAIN).length}`);
console.log(`  trocas que perdem os 4.800  ${sales.filter((s) => !s.keepsStep).length}`);
console.log(`  tier vendido T1/T2/T3/T4    ${[1, 2, 3, 4].map((t) => sales.filter((s) => s.sold.tier === t).length).join("/")}`);
console.log(`  itens finais < ${pct(LOW_PICK)} de compra ${rare} de ${total} (${pct(rare / total)})`);
console.log(`  itens em mais heróis (compra média) ${[...finals].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `${n} ${c} (${pct(mean(picks.get(n)!))})`).join(", ")}`);
console.log(`  T3+ em mais de 20 heróis com compra média < ${pct(LOW_PICK)}: ${[...finals].filter(([n, c]) => c > 20 && findItem(data, n).tier >= 3 && mean(picks.get(n)!) < LOW_PICK).map(([n]) => n).join(", ") || "nenhum"}`);
console.log(`  souls sem gastar por build  ${fmt(idle / heroes.length)}`);
console.log(`  slots vazios por build      ${fmt(emptySlots / heroes.length, 2)}`);
console.log(`  itens equipados por minuto  ${GRID.map((t) => `${t}: ${quantile(slotCounts.get(t)!)}/${quantile(slotCounts.get(t)!, 0.9)}`).join("  ")}  (p50/p90)`);
console.log(`  pontuação final média       ${fmt(mean(scores), 4)}`);
console.log(`  J médio                     ${fmt(mean(js), 4)}`);
console.log(`  J da rota médio             ${fmt(mean(planJs), 4)}  (src/optimizer/plan)`);
console.log(`  tempo por build             mediana ${fmt(quantile(times))} ms, máximo ${fmt(Math.max(...times))} ms`);
console.log(`  tempo                       ${fmt((Date.now() - started) / 1000)} s`);
const bad = sales.filter((s) => s.held < MIN_HOLD_MINUTES || s.chain || s.gain < MIN_SALE_GAIN || !s.keepsStep);
if (bad.length) console.log(`\nVendas fora das regras: ${bad.length}`);
for (const s of bad.sort((a, b) => a.held - b.held))
  console.log(`  ${s.hero}: ${s.sold.name} (${s.sold.cost}) -> ${s.bought.name}, ${fmt(s.held, 1)} min, ${pct(s.gain, 1)}${s.chain ? ", entrou por troca" : ""}${s.keepsStep ? "" : ", perde os 4.800"}`);
if (jsonFile) writeFileSync(jsonFile, JSON.stringify(routes, null, 1));

// --- Jogadores -------------------------------------------------------------

/** Compra de um jogador: item, instante da compra e da venda em s (0 = não vendeu), flags, patrimônio. */
type Buy = [id: number, bought: number, sold: number, flags: number, worth: number];
interface Sample {
  fetchedAt: string;
  matches: { duration: number; players: Buy[][] }[];
}
interface ApiMatch {
  duration_s: number;
  not_scored: boolean | null;
  players: { items: { item_id: number; game_time_s: number; sold_time_s: number; flags: number; net_worth_at_buy: number }[] | null }[];
}
const rawDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "raw", "sales");
const shop = new Map(data.items.map((i) => [i.id, i]));

async function sample(name: string, extra: Record<string, string>): Promise<Sample | null> {
  const file = join(rawDir, `${name}.json`);
  if (existsSync(file) && !args.includes("--download")) return JSON.parse(readFileSync(file, "utf8")) as Sample;
  const params = new URLSearchParams({
    include_info: "true",
    include_player_items: "true",
    game_mode: "normal",
    limit: "1000",
    order_by: "match_id",
    order_direction: "desc",
    min_unix_timestamp: String(Math.floor(Date.now() / 1000) - 14 * 86400),
    ...extra,
  });
  const res = await fetch(`https://api.deadlock-api.com/v1/matches/metadata?${params}`).catch(() => null);
  if (!res?.ok) {
    console.log(`\nJogadores (${name}): sem dados (${res ? `HTTP ${res.status}` : "sem rede"}).`);
    return null;
  }
  const matches = ((await res.json()) as ApiMatch[])
    .filter((m) => !m.not_scored && m.duration_s >= 600 && m.players.length === 12)
    .map((m) => ({
      duration: m.duration_s,
      players: m.players.filter((p) => p.items).map((p) => p.items!.filter((e) => shop.has(e.item_id)).map((e): Buy => [e.item_id, e.game_time_s, e.sold_time_s, e.flags, e.net_worth_at_buy])),
    }));
  mkdirSync(rawDir, { recursive: true });
  const out: Sample = { fetchedAt: new Date().toISOString(), matches };
  writeFileSync(file, JSON.stringify(out));
  return out;
}

const BANDS: [string, number, number][] = [
  ["todos", 0, Infinity],
  ["30-40k", 30_000, 40_000],
  ["40-50k", 40_000, 50_000],
  ["50k+", 50_000, Infinity],
];
/** Marca de componente consumido por um upgrade (inferida dos dados). */
const UPGRADED = 1;
function players(title: string, s: Sample): void {
  console.log(`\nJogadores, ${title}: ${s.matches.length} partidas (${s.fetchedAt.slice(0, 10)})`);
  for (const [label, from, to] of BANDS) {
    let n = 0;
    let lost = 0;
    const held: number[] = [];
    const tiers = [0, 0, 0, 0];
    for (const m of s.matches)
      for (const buys of m.players) {
        const worth = Math.max(0, ...buys.map((b) => b[4]));
        if (worth < from || worth >= to) continue;
        n++;
        for (const [id, bought, sold, flags] of buys) {
          if (!sold || sold - bought < UNDO_SECONDS) continue;
          const item = shop.get(id)!;
          if (flags & UPGRADED || buys.some((b) => Math.abs(b[1] - sold) <= 1 && componentTree(data, shop.get(b[0])!).has(item.className))) continue;
          lost += item.cost / 2;
          tiers[item.tier - 1]!++;
          held.push((sold - bought) / 60);
        }
      }
    const share = (t: number) => pct(t / Math.max(1, held.length));
    console.log(`  ${label.padEnd(7)} ${String(n).padStart(6)} jogadores: ${fmt(held.length / Math.max(1, n), 2)} vendas, ${fmt(lost / Math.max(1, n))} souls perdidos, posse p10 ${fmt(quantile(held, 0.1), 1)}, < ${MIN_HOLD_MINUTES} min ${pct(held.filter((x) => x < MIN_HOLD_MINUTES).length / Math.max(1, held.length), 1)}, tiers ${tiers.map(share).join("/")}`);
  }
  const counts = GRID.map((t) => s.matches.filter((m) => m.duration >= t * 60).flatMap((m) => m.players.map((b) => b.filter(([, bought, sold]) => bought <= t * 60 && (!sold || sold > t * 60)).length)));
  console.log(`  itens equipados por minuto  ${GRID.map((t, i) => `${t}: ${quantile(counts[i]!)}/${quantile(counts[i]!, 0.9)}`).join("  ")}  (p50/p90)`);
}
const SAMPLES: [string, string, Record<string, string>][] = [
  ["todos", "todos os elos", {}],
  ["elo-alto", "elo alto", { min_average_badge: "101" }],
];
for (const [name, title, extra] of SAMPLES) {
  const s = await sample(name, extra);
  if (s) players(title, s);
}
