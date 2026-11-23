/**
 * Baixa do deadlock-api.com o que os jogadores de elo alto fazem com cada herói
 * e grava data/snapshot/elite.json: itens comprados (taxa e minuto médio) e a
 * ordem das habilidades.
 *
 *   npm run elite                 usa o cache de data/raw/elite quando existe
 *   npm run elite -- --refresh    baixa tudo de novo
 *   npm run elite -- --days 30    janela das partidas (padrão 30 dias)
 *
 * Elo alto = badge médio da partida >= 101 (Ascendant 1, cerca do top 3%). Herói
 * com menos de MIN_MATCHES partidas nesse elo usa >= 91 (Phantom 1, cerca do top 10%).
 * Três chamadas por herói; leva por volta de um minuto sem cache.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../src/data/load.ts";
import type { EliteAbilityOrder, EliteAbilityPick, EliteStats, HeroElite } from "../src/meta/elite.ts";
import type { ItemUsage } from "../src/meta/stats.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, "data", "raw", "elite");
const API = "https://api.deadlock-api.com";
const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const daysArg = args.indexOf("--days");
const days = daysArg >= 0 ? Number(args[daysArg + 1]) : 30;
if (!Number.isFinite(days) || days <= 0) throw new Error("--days precisa ser um número positivo.");

const BADGE = 101;
const FALLBACK_BADGE = 91;
const MIN_MATCHES = 1000;
const GAP_MS = 350; // ~170 por minuto, abaixo do limite de 200

const data = loadSnapshot();
const itemById = new Map(data.items.map((i) => [i.id, i]));
const slotByAbility = new Map(data.abilities.map((a) => [a.id, a.slot]));
const since = Math.floor(Date.now() / 86_400_000) * 86400 - days * 86400;
await mkdir(cacheDir, { recursive: true });

let lastCall = 0;
let calls = 0;
async function get<T>(path: string): Promise<T> {
  const file = join(cacheDir, path.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 180) + ".json");
  if (!refresh && existsSync(file)) return JSON.parse(await readFile(file, "utf8")) as T;
  for (let attempt = 0; ; attempt++) {
    const wait = lastCall + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    calls++;
    const res = await fetch(API + path);
    if (res.ok) {
      const body = (await res.json()) as T;
      await writeFile(file, JSON.stringify(body));
      return body;
    }
    if (attempt >= 3 || (res.status !== 429 && res.status < 500)) throw new Error(`${path}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
}

interface HeroStatRow {
  hero_id: number;
  matches: number;
  wins: number;
}
interface ItemStatRow {
  item_id: number;
  matches: number;
  wins: number;
  avg_buy_time_s: number;
}
interface OrderRow {
  abilities: number[];
  matches: number;
  wins: number;
}
interface MaxFirstRow {
  ability_id: number | null;
  matches: number;
  wins: number;
}
interface BadgeRow {
  badge_level: number;
  total_matches: number;
}

const range = `min_unix_timestamp=${since}&game_mode=normal`;
const badges = await get<BadgeRow[]>(`/v1/analytics/badge-distribution?${range}`);
const allMatches = badges.reduce((s, r) => s + r.total_matches, 0);
const share = badges.filter((r) => r.badge_level >= BADGE).reduce((s, r) => s + r.total_matches, 0) / Math.max(1, allMatches);
const totalsAt = new Map<number, HeroStatRow[]>();
for (const badge of [BADGE, FALLBACK_BADGE]) totalsAt.set(badge, await get<HeroStatRow[]>(`/v1/analytics/hero-stats?${range}&min_average_badge=${badge}`));

const heroes: Record<string, HeroElite> = {};
async function collect(hero: (typeof data.heroes)[number]): Promise<void> {
  const badge = [BADGE, FALLBACK_BADGE].find((b) => (totalsAt.get(b)!.find((r) => r.hero_id === hero.id)?.matches ?? 0) >= MIN_MATCHES);
  if (badge === undefined) {
    console.log(`${hero.name}: poucas partidas em elo alto, sem dados.`);
    return;
  }
  const total = totalsAt.get(badge)!.find((r) => r.hero_id === hero.id)!;
  const filter = `${range}&hero_id=${hero.id}&min_average_badge=${badge}`;

  const items: Record<string, ItemUsage> = {};
  for (const row of await get<ItemStatRow[]>(`/v1/analytics/item-stats?${filter}&min_matches=20`)) {
    const item = itemById.get(row.item_id);
    if (item) items[item.className] = { matches: row.matches, wins: row.wins, buyMinute: Math.round((row.avg_buy_time_s / 60) * 10) / 10 };
  }

  const maxFirst: EliteAbilityPick[] = (await get<MaxFirstRow[]>(`/v1/analytics/ability-max-first-stats?${filter}`))
    .flatMap((r) => {
      const slot = r.ability_id === null ? undefined : slotByAbility.get(r.ability_id);
      return slot === undefined ? [] : [{ slot, matches: r.matches, wins: r.wins }];
    })
    .sort((a, b) => b.matches - a.matches);

  // A ordem completa mais jogada. Sequências que citam habilidade fora do kit atual (patch antigo) são descartadas.
  const orders = await get<OrderRow[]>(`/v1/analytics/ability-order-stats?${filter}&min_matches=20`);
  let order: EliteAbilityOrder | null = null;
  for (const row of [...orders].sort((a, b) => b.matches - a.matches)) {
    const slots = row.abilities.map((id) => slotByAbility.get(id));
    if (slots.every((s): s is number => s !== undefined)) {
      order = { slots, matches: row.matches, wins: row.wins };
      break;
    }
  }

  heroes[String(hero.id)] = { heroId: hero.id, badge, matches: total.matches, wins: total.wins, items, maxFirst, order };
  console.log(`${hero.name}: ${total.matches} partidas (badge ${badge}+), ${Object.keys(items).length} itens, ordem ${order ? `${order.matches} partidas` : "sem amostra"}`);
}

const failed: string[] = [];
for (const hero of data.heroes) {
  try {
    await collect(hero);
  } catch (err) {
    failed.push(hero.name);
    console.log(`${hero.name}: falhou (${(err as Error).message}).`);
  }
}
if (failed.length) console.log(`Sem dados por falha da API: ${failed.join(", ")}. Rode de novo para completar.`);

const out: EliteStats = { fetchedAt: new Date().toISOString(), days, badge: BADGE, fallbackBadge: FALLBACK_BADGE, share, heroes };
await writeFile(join(root, "data", "snapshot", "elite.json"), JSON.stringify(out));
console.log(`\nGravado data/snapshot/elite.json: ${Object.keys(heroes).length} heróis, top ${(share * 100).toFixed(1)}% das partidas, ${calls} chamadas à API.`);
