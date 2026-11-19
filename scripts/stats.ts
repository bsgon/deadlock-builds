/**
 * Baixa estatísticas de partidas reais do deadlock-api.com e grava
 * data/snapshot/stats.json (curva de souls, winrate por duração, uso de itens e
 * builds publicadas mais jogadas de cada herói).
 *
 *   npm run stats                 usa o cache de data/raw/meta quando existe
 *   npm run stats -- --refresh    baixa tudo de novo
 *   npm run stats -- --days 30    janela das estatísticas (padrão 30 dias)
 *
 * A API aceita 200 requisições por minuto; o script espera entre as chamadas
 * e leva uns três minutos sem cache.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../src/data/load.ts";
import type { DurationBucket, HeroMeta, ItemUsage, MetaStats, PopularBuild } from "../src/meta/stats.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, "data", "raw", "meta");
const API = "https://api.deadlock-api.com";
const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const daysArg = args.indexOf("--days");
const days = daysArg >= 0 ? Number(args[daysArg + 1]) : 30;
if (!Number.isFinite(days) || days <= 0) throw new Error("--days precisa ser um número positivo.");

const GAP_MS = 350; // ~170 por minuto, abaixo do limite de 200
const TOP_BUILDS = 3;
const MAX_MINUTE = 50;
const DURATIONS: [number, number | null][] = [
  [0, 25],
  [25, 35],
  [35, 45],
  [45, null],
];

const data = loadSnapshot();
const itemById = new Map(data.items.map((i) => [i.id, i]));
// Arredondado ao dia, para o cache valer entre execuções no mesmo dia.
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
    // 429 ou erro temporário: espera e tenta de novo, até 3 vezes.
    if (attempt >= 3 || (res.status !== 429 && res.status < 500)) throw new Error(`${path}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
}

interface HeroStatRow {
  hero_id: number;
  matches: number;
  wins: number;
}
interface CurveRow {
  game_time: number;
  net_worth_avg: number;
}
interface ItemStatRow {
  item_id: number;
  matches: number;
  wins: number;
  avg_buy_time_s: number;
}
interface BuildStatRow {
  hero_build_id: number;
  matches: number;
  wins: number;
}
interface BuildRow {
  hero_build: {
    hero_build_id: number;
    name: string;
    details: { mod_categories: { name: string; optional: boolean | null; mods: { ability_id: number }[] | null }[] };
  };
}

// Só partidas normais e ranqueadas: o modo Brawl (street_brawl) tem itens e ritmo próprios.
const range = `min_unix_timestamp=${since}&game_mode=normal`;
const totals = await get<HeroStatRow[]>(`/v1/analytics/hero-stats?${range}`);
const durationRows = await Promise.all(
  DURATIONS.map(([from, to]) =>
    get<HeroStatRow[]>(`/v1/analytics/hero-stats?${range}&min_duration_s=${from * 60}${to === null ? "" : `&max_duration_s=${to * 60 - 1}`}`),
  ),
);

const heroes: Record<string, HeroMeta> = {};
async function collect(hero: (typeof data.heroes)[number]): Promise<void> {
  const total = totals.find((r) => r.hero_id === hero.id);
  if (!total || total.matches < 500) {
    console.log(`${hero.name}: poucas partidas na janela, sem estatísticas.`);
    return;
  }

  // Curva de souls: a API devolve pontos a cada poucos minutos; interpolamos por minuto.
  const curve = await get<CurveRow[]>(`/v1/analytics/player-performance-curve?${range}&hero_ids=${hero.id}&resolution=0`);
  const points = curve.map((r) => [r.game_time / 60, r.net_worth_avg] as const).sort((a, b) => a[0] - b[0]);
  const soulsByMinute: number[] = [];
  for (let m = 0; m <= MAX_MINUTE; m++) {
    const after = points.findIndex((p) => p[0] >= m);
    if (after <= 0) {
      // Antes do primeiro ponto: reta desde zero; depois do último: repete o último.
      const p = after === 0 ? points[0]! : points[points.length - 1]!;
      soulsByMinute.push(Math.round(after === 0 ? (p[1] * m) / Math.max(1, p[0]) : p[1]));
      continue;
    }
    const [m0, s0] = points[after - 1]!;
    const [m1, s1] = points[after]!;
    soulsByMinute.push(Math.round(s0 + ((m - m0) / (m1 - m0)) * (s1 - s0)));
  }

  const byDuration: DurationBucket[] = DURATIONS.map(([fromMin, toMin], i) => {
    const row = durationRows[i]!.find((r) => r.hero_id === hero.id);
    return { fromMin, toMin, matches: row?.matches ?? 0, wins: row?.wins ?? 0 };
  });

  const items: Record<string, ItemUsage> = {};
  for (const row of await get<ItemStatRow[]>(`/v1/analytics/item-stats?${range}&hero_id=${hero.id}&min_matches=50`)) {
    const item = itemById.get(row.item_id);
    if (item) items[item.className] = { matches: row.matches, wins: row.wins, buyMinute: Math.round((row.avg_buy_time_s / 60) * 10) / 10 };
  }

  const builds: PopularBuild[] = [];
  const buildStats = await get<BuildStatRow[]>(`/v1/analytics/hero-build-stats/${hero.id}?${range}&min_matches=100`);
  for (const stat of [...buildStats].sort((a, b) => b.matches - a.matches)) {
    if (builds.length >= TOP_BUILDS) break;
    const found = await get<BuildRow[]>(`/v1/builds?build_id=${stat.hero_build_id}&only_latest=true`);
    const build = found[0]?.hero_build;
    if (!build) continue;
    const core: string[] = [];
    const optional: string[] = [];
    for (const category of build.details.mod_categories) {
      for (const mod of category.mods ?? []) {
        const item = itemById.get(mod.ability_id);
        if (!item || core.includes(item.className) || optional.includes(item.className)) continue;
        (category.optional ? optional : core).push(item.className);
      }
    }
    if (core.length < 3) continue; // build sem itens reconhecíveis (patch antigo ou só habilidades)
    builds.push({ id: build.hero_build_id, name: build.name.trim(), matches: stat.matches, wins: stat.wins, core, optional });
  }

  heroes[String(hero.id)] = { heroId: hero.id, matches: total.matches, wins: total.wins, soulsByMinute, byDuration, items, builds };
  console.log(`${hero.name}: ${total.matches} partidas, ${Object.keys(items).length} itens, ${builds.length} builds, ${soulsByMinute[15]} souls aos 15 min`);
}

// Um herói com falha na API não derruba os outros; rodar de novo completa o que faltou.
const failed: string[] = [];
for (const hero of data.heroes) {
  try {
    await collect(hero);
  } catch (err) {
    failed.push(hero.name);
    console.log(`${hero.name}: falhou (${(err as Error).message}).`);
  }
}
if (failed.length) console.log(`Sem estatísticas por falha da API: ${failed.join(", ")}. Rode de novo para completar.`);

const stats: MetaStats = { fetchedAt: new Date().toISOString(), days, heroes };
await writeFile(join(root, "data", "snapshot", "stats.json"), JSON.stringify(stats));
console.log(`\nGravado data/snapshot/stats.json: ${Object.keys(heroes).length} heróis, janela de ${days} dias, ${calls} chamadas à API.`);
