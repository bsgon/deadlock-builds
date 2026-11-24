/**
 * Mede a ordem de compra do otimizador contra o ritmo dos jogadores.
 *
 *   npm run order-report [-- Haze Paige ...]
 *
 * Para cada herói monta a build padrão do app (Otimizada, 50.000 souls, 12 slots) e
 * mostra o minuto da primeira compra de cada tier, a maior espera entre compras por
 * fase, os souls que ficaram parados e quanto cada item é comprado com o herói.
 * Com data/raw/wpa (npm run wpa), mostra ao lado os mesmos números dos jogadores
 * do herói, com todos os elos.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../src/data/load.ts";
import { findHero } from "../src/engine/index.ts";
import { VITALITY_SPIKE_SOULS } from "../src/engine/rules.ts";
import { heroElite } from "../src/meta/elite.ts";
import { buyMinute, heroMeta, minuteForSouls, pickRate, vitalitySpikeOf } from "../src/meta/stats.ts";
import type { CompactMatch } from "../src/meta/wpa.ts";
import { optimize } from "../src/optimizer/optimize.ts";

const DEFAULT_HEROES = ["Paige", "Infernus", "Haze", "Abrams", "Seven", "Vindicta"];
/** Fases pelo minuto em que a espera começa: [início, fim). */
const PHASES: [number, number][] = [
  [0, 5],
  [5, 10],
  [10, 15],
  [15, Infinity],
];
const LOW_PICK = 0.05;
const TIERS = [1, 2, 3, 4];

const data = loadSnapshot();
const args = process.argv.slice(2);
const heroes = (args.length ? args : DEFAULT_HEROES).map((n) => findHero(data, n));
const n1 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? "-" : x.toFixed(1));
const pct = (x: number | null | undefined) => (x === null || x === undefined ? "-" : `${Math.round(x * 100)}%`);
const phaseName = ([from, to]: [number, number]) => (to === Infinity ? `${from}+` : `${from}-${to}`);

/** Ritmo dos jogadores de um herói. */
interface Pace {
  players: number;
  /** Minuto da primeira compra de cada tier, por jogador. */
  first: number[][];
  /** Espera entre compras (minutos), por fase. */
  gaps: number[][];
}
const paces = new Map<number, Pace>(heroes.map((h) => [h.id, { players: 0, first: TIERS.map(() => []), gaps: PHASES.map(() => []) }]));
const rawDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "raw", "wpa");
const tierOf = new Map(data.items.map((i) => [i.id, i.tier]));
const pages = existsSync(rawDir) ? readdirSync(rawDir).filter((f) => /^page-\d+\.json$/.test(f)) : [];
for (const file of pages) {
  for (const match of JSON.parse(readFileSync(join(rawDir, file), "utf8")) as CompactMatch[]) {
    for (const player of match.players) {
      const pace = paces.get(player.hero);
      if (!pace) continue;
      pace.players++;
      const seen = new Set<number>();
      let last = 0;
      for (const [t, id] of player.buys) {
        const minute = t / 60;
        const phase = PHASES.findIndex(([from, to]) => last >= from && last < to);
        pace.gaps[phase]!.push(minute - last);
        last = minute;
        const tier = tierOf.get(id);
        if (tier === undefined || seen.has(tier)) continue;
        seen.add(tier);
        pace.first[tier - 1]?.push(minute);
      }
    }
  }
}
const quantile = (xs: number[], q: number) => {
  const sorted = xs.toSorted((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]! : null;
};

for (const hero of heroes) {
  const spike = vitalitySpikeOf(data, hero.id, VITALITY_SPIKE_SOULS);
  const result = optimize(data, {
    hero: hero.name,
    objective: "optimized",
    souls: 50_000,
    itemSlots: 12,
    vitalitySpike: spike ? { souls: VITALITY_SPIKE_SOULS, deadline: spike.souls } : false,
  });
  const meta = heroMeta(data, hero.id);
  const elite = heroElite(data, hero.id);
  const pace = paces.get(hero.id)!;
  let earned = 0;
  let idle = 0;
  const worst = PHASES.map(() => 0);
  const rows = result.order.map((step) => {
    const from = minuteForSouls(data, hero.id, earned);
    const gap = step.minute - from;
    const parked = step.earned - earned - step.cost;
    const phase = PHASES.findIndex(([a, b]) => from >= a && from < b);
    worst[phase] = Math.max(worst[phase]!, gap);
    idle += parked;
    earned = step.earned;
    const rate = meta ? pickRate(meta, step.item) : null;
    const use = elite?.items[step.item.className];
    return { step, gap, parked, rate, elite: elite ? (use?.matches ?? 0) / elite.matches : null };
  });

  console.log(`\n== ${hero.name}: ${result.score.toFixed(3)} pontos, ${result.order.length} compras, ${idle} souls parados, ${rows.filter((r) => (r.rate ?? 0) < LOW_PICK).length} com menos de ${LOW_PICK * 100}% de compra`);
  console.log(`jogadores: ${pace.players}`);
  for (const tier of TIERS) {
    const mine = result.order.find((s) => s.item.tier === tier)?.minute;
    const times = pace.first[tier - 1]!;
    console.log(`1º T${tier}: app ${n1(mine)} | jogadores p10 ${n1(quantile(times, 0.1))} p50 ${n1(quantile(times, 0.5))} p75 ${n1(quantile(times, 0.75))}`);
  }
  PHASES.forEach((phase, i) => console.log(`espera ${phaseName(phase)} min: app máx ${n1(worst[i])} | jogadores p50 ${n1(quantile(pace.gaps[i]!, 0.5))} p90 ${n1(quantile(pace.gaps[i]!, 0.9))}`));
  console.log("  min  esper parad  compra elite real  item");
  for (const { step, gap, parked, rate, elite: e } of rows) {
    const cell = (x: string | number, w: number) => String(x).padStart(w);
    console.log(
      `${cell(n1(step.minute), 5)} ${cell(n1(gap), 6)} ${cell(parked, 5)} ${cell(pct(rate), 7)} ${cell(pct(e), 5)} ${cell(n1(buyMinute(data, hero.id, step.item)), 4)}  T${step.item.tier} ${step.item.name} (${step.cost})${step.upgradeFrom ? ` melhora ${step.upgradeFrom.name}` : ""}${step.sold ? ` vende ${step.sold.name}` : ""}`,
    );
  }
}
