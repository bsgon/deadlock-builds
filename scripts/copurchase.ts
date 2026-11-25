/**
 * Quais T2/T3 os compradores de cada T4 também compram, contra o esperado para o mesmo
 * herói com souls parecidos. Usa as partidas já baixadas por `npm run wpa` (data/raw/wpa)
 * e grava data/snapshot/copurchase.json. Componentes do T4 ficam de fora.
 *
 *   npm run copurchase
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../src/data/load.ts";
import { MIN_EXPECTED, recipeOf, type CopurchaseStats } from "../src/knowledge/item-combos.ts";
import type { CompactMatch } from "../src/meta/wpa.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = join(root, "data", "raw", "wpa");
const pages = existsSync(rawDir) ? readdirSync(rawDir).filter((f) => /^page-\d+\.json$/.test(f)) : [];
if (pages.length === 0) throw new Error("Sem partidas em data/raw/wpa: rode `npm run wpa` antes.");

/** Quem tem menos souls que isto quase não compra T4. */
const MIN_WORTH = 15_000;
const WORTH_STEP = 5_000;
const MAX_STEP = 10;

const data = loadSnapshot();
const items = data.items.filter((i) => i.tier >= 2);
const n = items.length;
const index = new Map(items.map((i, k) => [i.id, k]));
const strata = new Map<string, { players: number; count: Float64Array; joint: Float64Array }>();
let matches = 0;
let players = 0;
for (const page of pages) {
  for (const match of JSON.parse(readFileSync(join(rawDir, page), "utf8")) as CompactMatch[]) {
    matches++;
    for (const p of match.players) {
      const worth = p.nw.at(-1) ?? 0;
      if (worth < MIN_WORTH) continue;
      players++;
      const key = `${p.hero}|${Math.min(MAX_STEP, Math.floor(worth / WORTH_STEP))}`;
      let s = strata.get(key);
      if (!s) strata.set(key, (s = { players: 0, count: new Float64Array(n), joint: new Float64Array(n * n) }));
      s.players++;
      const bought = p.buys.map(([, id]) => index.get(id)).filter((k) => k !== undefined);
      for (const a of bought) {
        s.count[a]! += 1;
        for (const b of bought) if (a !== b) s.joint[a * n + b]! += 1;
      }
    }
  }
}

const out: CopurchaseStats = { matches, players, items: {} };
items.forEach((t4, a) => {
  if (t4.tier !== 4) return;
  const recipe = recipeOf(data, t4);
  let buyers = 0;
  for (const s of strata.values()) buyers += s.count[a]!;
  const partners: Record<string, [number, number]> = {};
  items.forEach((partner, b) => {
    if (partner.tier > 3 || recipe.has(partner.className)) return;
    let both = 0;
    let expected = 0;
    for (const s of strata.values()) {
      both += s.joint[a * n + b]!;
      expected += (s.count[a]! * s.count[b]!) / s.players;
    }
    if (expected >= MIN_EXPECTED) partners[partner.className] = [both, Math.round(expected * 10) / 10];
  });
  out.items[t4.className] = { buyers, partners };
});
writeFileSync(join(root, "data", "snapshot", "copurchase.json"), `${JSON.stringify(out)}\n`);
console.log(`${matches} partidas, ${players} jogadores com ${MIN_WORTH}+ souls → data/snapshot/copurchase.json`);
