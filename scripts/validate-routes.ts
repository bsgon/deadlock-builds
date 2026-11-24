/**
 * Valida as rotas do otimizador em partidas fora da amostra: jogadores cujas compras
 * se parecem mais com a rota vencem mais do que o placar previa?
 *
 *   npm run validate-routes -- --download            baixa as partidas mais novas que as de data/raw/sales
 *   npm run validate-routes -- --routes              calcula as rotas atuais (progressiva e plan)
 *   npm run validate-routes -- --extra=nome=arquivo  soma rotas gravadas por build-report --json
 *   npm run validate-routes -- --sample=sales        usa data/raw/sales em vez de data/raw/holdout
 *   npm run validate-routes -- --min-badge=101       só partidas do elo
 *
 * Método (registrado em docs/plano-builds-v2.md antes de olhar os resultados):
 *   - em cada jogador, no minuto T, os itens que ele tem são comparados com o que a rota
 *     do herói teria com o mesmo patrimônio (sobreposição de souls, contando componentes);
 *   - resultado ajustado = venceu − P(vitória | vantagem de patrimônio, minuto), com modelo
 *     ajustado em partidas ANTERIORES (data/raw/wpa), não nas da validação;
 *   - a semelhança é centrada por herói; o efeito é a inclinação, em pp por desvio-padrão;
 *   - intervalos por reamostragem de partidas inteiras (os 12 jogadores vão juntos).
 * Também mede o uso (taxa média de compra dos itens do jogador), para saber se uma rota
 * diz algo além de "compre o que todo mundo compra".
 *
 * É associação: quem segue uma rota pode jogar melhor por outros motivos.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Item } from "../src/data/types.ts";
import { loadSnapshot } from "../src/data/load.ts";
import { componentTree, equippedItems, findItem } from "../src/engine/index.ts";
import { VITALITY_SPIKE_SOULS } from "../src/engine/rules.ts";
import { exitOf, type SaleBuy, type SaleMatch } from "../src/meta/sales.ts";
import { vitalitySpikeOf } from "../src/meta/stats.ts";
import { usageRate } from "../src/meta/usage.ts";
import { features, fitLogistic, teamWorth, trainingSet, winProbability, worthAt, type CompactMatch } from "../src/meta/wpa.ts";
import { optimize } from "../src/optimizer/optimize.ts";
import { within, slope, type Row } from "../src/meta/validation.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = (...p: string[]) => join(root, "data", "raw", ...p);
const args = process.argv.slice(2);
const value = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const data = loadSnapshot();
const shop = new Map(data.items.map((i) => [i.id, i]));
const isPage = (f: string) => /^page-\d+\.json$/.test(f);
const pages = <T,>(dir: string): T[] => (existsSync(dir) ? readdirSync(dir).filter(isPage).flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as T[]) : []);

// --- Download --------------------------------------------------------------
const MIN_AFTER = 600;
interface ApiMatch {
  match_id: number;
  winning_team: string;
  duration_s: number;
  average_badge: number | null;
  not_scored: boolean | null;
  players: { hero_id: number; team: string; items: { item_id: number; game_time_s: number; sold_time_s: number; flags: number; net_worth_at_buy: number }[] | null }[];
}
if (args.includes("--download")) {
  mkdirSync(raw("holdout"), { recursive: true });
  const seen = Math.max(...pages<SaleMatch>(raw("sales")).map((m) => m.id));
  const have = pages<SaleMatch>(raw("holdout"));
  let maxId = have.length ? Math.min(...have.map((m) => m.id)) - 1 : undefined;
  let n = have.length;
  for (;;) {
    const params = new URLSearchParams({ include_info: "true", include_player_items: "true", game_mode: "normal", limit: "500", order_by: "match_id", order_direction: "desc", min_match_id: String(seen + 1), ...(maxId ? { max_match_id: String(maxId) } : {}) });
    const res = await fetch(`https://api.deadlock-api.com/v1/matches/metadata?${params}`);
    // Sem partidas no intervalo, a API responde 404.
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`metadata: HTTP ${res.status}; rode de novo para continuar.`);
    const page = (await res.json()) as ApiMatch[];
    if (!page.length) break;
    const team = (t: string) => (t === "Team1" ? 1 : 0);
    const kept = page
      .filter((m) => !m.not_scored && m.duration_s >= MIN_AFTER && m.players.length === 12)
      .map(
        (m): SaleMatch => ({
          id: m.match_id,
          winner: team(m.winning_team),
          duration: m.duration_s,
          badge: m.average_badge ?? 0,
          players: m.players.map((p) => ({
            hero: p.hero_id,
            team: team(p.team),
            buys: (p.items ?? []).filter((e) => shop.has(e.item_id)).sort((a, b) => a.game_time_s - b.game_time_s).map((e): SaleBuy => [e.item_id, e.game_time_s, e.sold_time_s, e.flags, e.net_worth_at_buy]),
          })),
        }),
      );
    maxId = Math.min(...page.map((m) => m.match_id)) - 1;
    writeFileSync(raw("holdout", `page-${maxId}.json`), JSON.stringify(kept));
    n += kept.length;
    console.log(`${n} partidas`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// --- Rotas -----------------------------------------------------------------
interface SavedStep {
  item: string;
  sold: string | null;
  earned: number;
}
type Routes = Record<string, SavedStep[]>;
const routeFile = raw("routes.json");
if (args.includes("--routes")) {
  const out: Record<string, Routes> = { atual: {}, plan: {} };
  for (const hero of data.heroes) {
    const own = vitalitySpikeOf(data, hero.id, VITALITY_SPIKE_SOULS);
    const input = { hero: hero.name, objective: "optimized", souls: 50_000, itemSlots: 12, vitalitySpike: own ? { souls: VITALITY_SPIKE_SOULS, deadline: own.souls } : false } as const;
    for (const [name, mode] of [["atual", "progressive"], ["plan", "plan"]] as const)
      out[name]![hero.name] = optimize(data, { ...input, mode }).order.map((s) => ({ item: s.item.name, sold: s.sold?.name ?? null, earned: s.earned }));
  }
  writeFileSync(routeFile, JSON.stringify(out));
  console.log("Rotas gravadas.");
}
if (!existsSync(routeFile)) throw new Error("Sem rotas: rode com --routes.");
const all: Record<string, Routes> = JSON.parse(readFileSync(routeFile, "utf8"));
for (const extra of args.filter((a) => a.startsWith("--extra="))) {
  const [name, file] = extra.slice("--extra=".length).split("=") as [string, string];
  all[name] = Object.fromEntries((JSON.parse(readFileSync(file, "utf8")) as { hero: string; order: SavedStep[] }[]).map((r) => [r.hero, r.order]));
}
const names = Object.keys(all);

// --- Semelhança -------------------------------------------------------------
/** Souls de cada peça: o item vale o que custou além dos componentes, e os componentes contam junto. */
const pieceCache = new Map<string, Map<string, number>>();
const byClass = new Map(data.items.map((i) => [i.className, i]));
function pieces(items: Item[]): Map<string, number> {
  const key = items.map((i) => i.className).join();
  let out = pieceCache.get(key);
  if (out) return out;
  out = new Map();
  for (const item of items)
    for (const cls of [item.className, ...componentTree(data, item)]) {
      const i = byClass.get(cls);
      if (!i) continue;
      const parts = i.components.reduce((s, c) => s + (byClass.get(c)?.cost ?? 0), 0);
      out.set(cls, Math.max(0, i.cost - parts));
    }
  if (pieceCache.size > 20_000) pieceCache.clear();
  pieceCache.set(key, out);
  return out;
}
/** Sobreposição em souls: o que os dois têm ÷ o que pelo menos um tem. */
function overlap(a: Map<string, number>, b: Map<string, number>): number {
  let both = 0;
  let total = 0;
  for (const [c, v] of a) {
    total += v;
    if (b.has(c)) both += v;
  }
  for (const [c, v] of b) if (!a.has(c)) total += v;
  return total > 0 ? both / total : 0;
}
const heroById = new Map(data.heroes.map((h) => [h.id, h]));
const steps: Record<string, Record<string, { earned: number; after: Item[] }[]>> = {};
for (const n of names) {
  steps[n] = {};
  for (const [hero, order] of Object.entries(all[n]!)) {
    let owned: Item[] = [];
    steps[n]![hero] = order.map((s) => {
      const sold = s.sold ? findItem(data, s.sold) : null;
      owned = equippedItems(data, [...owned.filter((i) => i !== sold), findItem(data, s.item)]);
      return { earned: s.earned, after: owned };
    });
  }
}
function routeAt(name: string, hero: string, souls: number): Item[] {
  let items: Item[] = [];
  for (const s of steps[name]![hero] ?? []) {
    if (s.earned > souls) break;
    items = s.after;
  }
  return items;
}

// --- Modelo de vitória: só partidas anteriores -----------------------------
const train = pages<CompactMatch>(raw("wpa"));
if (!train.length) throw new Error("Sem data/raw/wpa para o modelo de vitória.");
const { xs, ys } = trainingSet(train);
const coef = fitLogistic(xs, ys);
const lastTrain = Math.max(...train.map((m) => m.id));

const minBadge = Number(value("min-badge") ?? 0);
const sample = value("sample") ?? "holdout";
const matches = pages<SaleMatch>(raw(sample)).filter((m) => m.badge >= minBadge && m.id > lastTrain);
console.log(`Validação: ${matches.length} partidas (${sample}${minBadge ? `, elo ≥ ${minBadge}` : ""}), todas depois da última usada no modelo de vitória.`);

const compact = (m: SaleMatch): CompactMatch => ({
  id: m.id,
  winner: m.winner,
  duration: m.duration,
  players: m.players.map((p) => ({ hero: p.hero, team: p.team, t: p.buys.map((b) => b[1]), nw: p.buys.map((b) => b[4]), buys: p.buys.map((b) => [b[1], b[0]]) })),
});
/** Referência de uso: taxa de compra média (em log) dos itens que o jogador tem. */
const rates = new Map<string, number>();
const rateOf = (hero: number, item: Item) => {
  const key = `${hero}|${item.className}`;
  let r = rates.get(key);
  if (r === undefined) rates.set(key, (r = Math.log(Math.max(0.002, usageRate(data, hero, item) ?? 0.002))));
  return r;
};

const PRIMARY_MINUTE = 25;
const BOOT = 400;
for (const minute of [15, PRIMARY_MINUTE, 35]) {
  const t = minute * 60;
  const rows: Row[] = [];
  let brier = 0;
  let predicted = 0;
  for (const m of matches) {
    if (m.duration < t + 120) continue;
    const c = compact(m);
    m.players.forEach((p, i) => {
      const hero = heroById.get(p.hero);
      if (!hero || !p.buys.length) return;
      const exits = p.buys.map((b) => exitOf(data, shop, b, p.buys));
      const held = equippedItems(data, p.buys.filter((b, k) => exits[k] !== "undone" && b[1] <= t && (!b[2] || b[2] > t)).map((b) => shop.get(b[0])!));
      if (held.length < 3) return;
      const worth = worthAt(c.players[i]!, t);
      const mine = pieces(held);
      const { own, enemy } = teamWorth(c, p.team, t);
      const prob = winProbability(coef, features(own, enemy, t));
      const won = m.winner === p.team ? 1 : 0;
      brier += (won - prob) ** 2;
      predicted++;
      const cost = held.reduce((s, x) => s + x.cost, 0);
      rows.push({
        group: p.hero,
        cluster: m.id,
        y: won - prob,
        x: [...names.map((n) => overlap(mine, pieces(routeAt(n, hero.name, worth)))), held.reduce((s, x) => s + x.cost * rateOf(p.hero, x), 0) / cost],
      });
    });
  }
  if (rows.length < 1000) {
    console.log(`\nMinuto ${minute}: ${rows.length} jogadores, pouco para medir.`);
    continue;
  }
  const labels = [...names, "uso"];
  const centered = within(rows);
  console.log(`\nMinuto ${minute}${minute === PRIMARY_MINUTE ? " (principal)" : ""}: ${rows.length} jogadores, Brier do modelo de vitória ${(brier / predicted).toFixed(4)}`);
  const raws = labels.map((_, k) => rows.reduce((s, r) => s + r.x[k]!, 0) / rows.length);
  const stat = (sel: Row[]) => labels.map((_, k) => slope(sel, [k])[0]!);
  const partial = (sel: Row[]) => names.map((_, k) => slope(sel, [k, names.length])[0]!);
  // Reamostra partidas inteiras.
  const groups = new Map<number, Row[]>();
  for (const r of centered) groups.set(r.cluster, [...(groups.get(r.cluster) ?? []), r]);
  const clusters = [...groups.values()];
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff), seed / 0x80000000);
  const boots: { s: number[]; p: number[] }[] = [];
  for (let b = 0; b < BOOT; b++) {
    const sel: Row[] = [];
    for (let k = 0; k < clusters.length; k++) sel.push(...clusters[Math.floor(rnd() * clusters.length)]!);
    boots.push({ s: stat(sel), p: partial(sel) });
  }
  const ci = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return `[${(s[Math.floor(0.025 * s.length)]! * 100).toFixed(2)}; ${(s[Math.floor(0.975 * s.length)]! * 100).toFixed(2)}]`;
  };
  const s0 = stat(centered);
  const p0 = partial(centered);
  console.log(`  ${"rota".padEnd(12)} semelhança   pp por desvio-padrão          descontado o uso`);
  labels.forEach((n, k) =>
    console.log(
      `  ${n.padEnd(12)} ${(k < names.length ? `${(raws[k]! * 100).toFixed(1)}%` : raws[k]!.toFixed(2)).padStart(8)}     ${(s0[k]! * 100).toFixed(2).padStart(6)} ${ci(boots.map((b) => b.s[k]!)).padEnd(18)}${k < names.length ? ` ${(p0[k]! * 100).toFixed(2).padStart(6)} ${ci(boots.map((b) => b.p[k]!))}` : ""}`,
    ),
  );
  const diff = (a: string, b: string) => {
    const [i, j] = [names.indexOf(a), names.indexOf(b)];
    if (i < 0 || j < 0) return;
    console.log(`  ${a} − ${b}: ${((s0[i]! - s0[j]!) * 100).toFixed(2)} pp ${ci(boots.map((x) => x.s[i]! - x.s[j]!))}; descontado o uso ${((p0[i]! - p0[j]!) * 100).toFixed(2)} ${ci(boots.map((x) => x.p[i]! - x.p[j]!))}`);
  };
  for (const a of names) for (const b of names) if (names.indexOf(a) > names.indexOf(b)) diff(a, b);
}
