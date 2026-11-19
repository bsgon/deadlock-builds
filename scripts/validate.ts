/**
 * Compara as builds do otimizador com o que os jogadores realmente compram.
 *
 *   npm run validate                 todos os heróis, 20000 souls
 *   npm run validate -- 15000        outro orçamento
 *   npm run validate -- --refresh    baixa de novo as estatísticas (o padrão usa o cache)
 *
 * Para cada herói e objetivo, olha os itens escolhidos e mede duas coisas nos
 * dados de partidas do deadlock-api.com:
 *  - popularidade: partidas com o item nesse herói, relativa ao item mais comprado dele;
 *  - winrate do item nesse herói, comparado com a média dos itens do herói.
 *
 * Não é prova de que uma build é boa (winrate mistura muita coisa), mas um
 * otimizador que insiste em itens que quase ninguém compra e que perdem mais
 * que a média está provavelmente superestimando esses itens.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../src/data/load.ts";
import type { Objective } from "../src/optimizer/metrics.ts";
import { optimize } from "../src/optimizer/optimize.ts";
import { windowStat } from "../src/meta/windows.ts";

const API = "https://api.deadlock-api.com";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, "data", "raw", "item-stats");
const refresh = process.argv.includes("--refresh");
const souls = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 20_000);
/** --match-weight=N: peso das partidas na escolha (padrão do otimizador). */
const weightArg = process.argv.find((a) => a.startsWith("--match-weight="));
const matchWeight = weightArg ? Number(weightArg.split("=")[1]) : undefined;
const OBJECTIVES: Objective[] = ["dps", "weapon", "spirit", "tank"];
/** Abaixo disso (relativo ao item mais comprado do herói) o item é "de nicho". */
const NICHE = 0.03;

interface Row {
  item_id: number;
  wins: number;
  matches: number;
}

async function itemStats(heroId: number): Promise<Row[]> {
  const file = join(cacheDir, `${heroId}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(await readFile(file, "utf8"));
  const res = await fetch(`${API}/v1/analytics/item-stats?hero_id=${heroId}&min_matches=50`);
  if (!res.ok) throw new Error(`item-stats do herói ${heroId}: HTTP ${res.status}`);
  const rows = (await res.json()) as Row[];
  await mkdir(cacheDir, { recursive: true });
  await writeFile(file, JSON.stringify(rows.map(({ item_id, wins, matches }) => ({ item_id, wins, matches }))));
  await new Promise((r) => setTimeout(r, 400)); // respeita o limite de requisições da API
  return rows;
}

const data = loadSnapshot();
const shopIds = new Set(data.items.map((i) => i.id));

interface Tally {
  picks: number;
  niche: number;
  liftSum: number;
  liftCount: number;
}
const byObjective = new Map<Objective, Tally>(OBJECTIVES.map((o) => [o, { picks: 0, niche: 0, liftSum: 0, liftCount: 0 }]));
/** Compras do otimizador contra o que o herói compra no mesmo momento da partida. */
const inWindow = new Map<Objective, { n: number; deltaSum: number; above: number; below: number; ties: number; steps: number }>(OBJECTIVES.map((o) => [o, { n: 0, deltaSum: 0, above: 0, below: 0, ties: 0, steps: 0 }]));
const offenders = new Map<string, { builds: number; niche: number; liftSum: number; liftCount: number }>();

for (const hero of data.heroes) {
  const rows = (await itemStats(hero.id)).filter((r) => shopIds.has(r.item_id));
  if (rows.length === 0) continue;
  const stats = new Map(rows.map((r) => [r.item_id, r]));
  const top = Math.max(...rows.map((r) => r.matches));
  const mean = rows.reduce((s, r) => s + r.wins, 0) / rows.reduce((s, r) => s + r.matches, 0);

  for (const objective of OBJECTIVES) {
    const tally = byObjective.get(objective)!;
    const result = optimize(data, { hero: hero.name, objective, souls, ...(matchWeight !== undefined ? { matchWeight } : {}) });
    const w = inWindow.get(objective)!;
    for (const step of result.order) {
      w.steps++;
      if (step.tieBreak) w.ties++;
      const stat = windowStat(data, hero.id, step.item, step.minute);
      if (!stat) continue;
      w.n++;
      w.deltaSum += stat.delta;
      if (stat.delta - stat.margin > 0) w.above++;
      if (stat.delta + stat.margin < 0) w.below++;
    }
    for (const item of result.items) {
      const row = stats.get(item.id);
      const share = row ? row.matches / top : 0;
      const o = offenders.get(item.name) ?? { builds: 0, niche: 0, liftSum: 0, liftCount: 0 };
      o.builds++;
      tally.picks++;
      if (share < NICHE) {
        tally.niche++;
        o.niche++;
      }
      // Winrate só conta com amostra razoável.
      if (row && row.matches >= 500) {
        const lift = row.wins / row.matches - mean;
        tally.liftSum += lift;
        tally.liftCount++;
        o.liftSum += lift;
        o.liftCount++;
      }
      offenders.set(item.name, o);
    }
  }
  process.stdout.write(".");
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)} pp`;
console.log(`\n\nBuilds de ${souls} souls para ${data.heroes.length} heróis (patch ${data.meta.clientVersion})\n`);
console.log("Objetivo   Itens   De nicho   Winrate vs média do herói");
let allPicks = 0;
let allNiche = 0;
let allLift = 0;
let allLiftCount = 0;
for (const [objective, t] of byObjective) {
  console.log(`${objective.padEnd(10)} ${String(t.picks).padStart(5)}   ${pct(t.niche / Math.max(1, t.picks)).padStart(8)}   ${signed(t.liftSum / Math.max(1, t.liftCount))}`);
  allPicks += t.picks;
  allNiche += t.niche;
  allLift += t.liftSum;
  allLiftCount += t.liftCount;
}
console.log(`${"total".padEnd(10)} ${String(allPicks).padStart(5)}   ${pct(allNiche / Math.max(1, allPicks)).padStart(8)}   ${signed(allLift / Math.max(1, allLiftCount))}`);

console.log("\nItens mais escolhidos pelo otimizador (em quantas builds; quantas vezes era de nicho; winrate vs média):");
for (const [name, o] of [...offenders.entries()].sort((a, b) => b[1].builds - a[1].builds).slice(0, 18)) {
  console.log(`  ${name.padEnd(26)} ${String(o.builds).padStart(3)} builds   ${String(o.niche).padStart(3)} de nicho   ${o.liftCount ? signed(o.liftSum / o.liftCount) : "sem amostra"}`);
}

if (data.windows) {
  console.log("\nCompras na janela de compra (winrate do item contra as compras do herói no mesmo intervalo de minutos):");
  console.log("Objetivo   Compras   Com amostra   Média      Acima (95%)   Abaixo (95%)   Desempates");
  for (const [objective, w] of inWindow) {
    console.log(`${objective.padEnd(10)} ${String(w.steps).padStart(7)}   ${String(w.n).padStart(11)}   ${(w.n ? `${(w.deltaSum / w.n >= 0 ? "+" : "") + (w.deltaSum / w.n).toFixed(2)} pp` : "n/d").padStart(8)}   ${String(w.above).padStart(11)}   ${String(w.below).padStart(12)}   ${String(w.ties).padStart(10)}`);
  }
} else console.log("\nSem data/snapshot/windows.json: rode npm run windows para comparar por janela de compra.");
