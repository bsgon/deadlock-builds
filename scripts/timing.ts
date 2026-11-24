/**
 * Mede o ritmo das compras nas partidas de data/raw/wpa (`npm run wpa` baixa) e grava
 * data/snapshot/timing.json. Não acessa a rede. Ver src/meta/timing.ts.
 *
 *   npm run timing
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../src/data/load.ts";
import { PACE_PHASES, pacePhase, type HeroPace, type PaceStats } from "../src/meta/timing.ts";
import type { CompactMatch } from "../src/meta/wpa.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = join(root, "data", "raw", "wpa");
const data = loadSnapshot();
const tierOf = new Map(data.items.map((i) => [i.id, i.tier]));
const pages = existsSync(rawDir) ? readdirSync(rawDir).filter((f) => /^page-\d+\.json$/.test(f)) : [];
if (!pages.length) throw new Error("Sem partidas em data/raw/wpa. Rode npm run wpa antes.");

interface Samples {
  players: number;
  first: number[][];
  wait: number[][];
}
const empty = (): Samples => ({ players: 0, first: [[], [], [], []], wait: PACE_PHASES.map(() => []) });
const overall = empty();
const heroes = new Map<number, Samples>();
let matches = 0;

for (const file of pages) {
  for (const match of JSON.parse(readFileSync(join(rawDir, file), "utf8")) as CompactMatch[]) {
    matches++;
    for (const player of match.players) {
      let own = heroes.get(player.hero);
      if (!own) heroes.set(player.hero, (own = empty()));
      for (const s of [own, overall]) {
        s.players++;
        const seen = new Set<number>();
        let last = 0;
        for (const [seconds, id] of player.buys) {
          const minute = seconds / 60;
          s.wait[pacePhase(last)]!.push(minute - last);
          last = minute;
          const tier = tierOf.get(id);
          if (tier === undefined || tier > 4 || seen.has(tier)) continue;
          seen.add(tier);
          s.first[tier - 1]!.push(minute);
        }
      }
    }
  }
}

const quantiles = (xs: number[], qs: number[]) => {
  const sorted = Float64Array.from(xs).sort();
  return qs.map((q) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]! * 10) / 10 : 0));
};
const summary = (s: Samples): HeroPace => ({
  players: s.players,
  first: s.first.map((xs) => quantiles(xs, [0.1, 0.5, 0.75]) as [number, number, number]),
  wait: s.wait.map((xs) => quantiles(xs, [0.5, 0.9]) as [number, number]),
});

const out: PaceStats = {
  fetchedAt: data.wpa?.fetchedAt ?? new Date().toISOString(),
  matches,
  overall: summary(overall),
  heroes: Object.fromEntries([...heroes].filter(([id]) => data.heroes.some((h) => h.id === id)).map(([id, s]) => [String(id), summary(s)])),
};
writeFileSync(join(root, "data", "snapshot", "timing.json"), JSON.stringify(out));
console.log(`Gravado data/snapshot/timing.json: ${matches} partidas, ${Object.keys(out.heroes).length} heróis.`);
console.log(JSON.stringify(out.overall));
