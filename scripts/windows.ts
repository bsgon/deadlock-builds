/**
 * Baixa o winrate de cada item por minuto de compra, por herói, e agrupa em
 * janelas de 10 minutos: data/snapshot/windows.json.
 *
 *   npm run windows                 usa o cache de data/raw/windows quando existe
 *   npm run windows -- --refresh    baixa de novo
 *   npm run windows -- --days 30    janela das partidas (padrão 30 dias)
 *
 * Uma chamada por herói (/v1/analytics/item-stats?bucket=game_time_min, só
 * partidas normais). O filtro de patrimônio da API usa o patrimônio final da
 * partida, que é informação posterior à compra, e por isso não é usado.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../src/data/load.ts";
import { WINDOWS, windowIndex, type PurchaseWindows } from "../src/meta/windows.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = join(root, "data", "raw", "windows");
const API = "https://api.deadlock-api.com";
const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const daysArg = args.indexOf("--days");
const days = daysArg >= 0 ? Number(args[daysArg + 1]) : 30;
if (!Number.isFinite(days) || days <= 0) throw new Error("--days precisa ser um número positivo.");
const GAP_MS = 400;

interface Row {
  item_id: number;
  bucket: number;
  wins: number;
  matches: number;
}

const data = loadSnapshot();
const itemById = new Map(data.items.map((i) => [i.id, i]));
const since = Math.floor(Date.now() / 86_400_000) * 86400 - days * 86400;
await mkdir(cacheDir, { recursive: true });

let lastCall = 0;
async function get(path: string): Promise<Row[]> {
  const file = join(cacheDir, path.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 180) + ".json");
  if (!refresh && existsSync(file)) return JSON.parse(await readFile(file, "utf8")) as Row[];
  for (let attempt = 0; ; attempt++) {
    const wait = lastCall + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const res = await fetch(API + path);
    if (res.ok) {
      const body = (await res.json()) as Row[];
      await writeFile(file, JSON.stringify(body));
      return body;
    }
    if (attempt >= 3 || (res.status !== 429 && res.status < 500)) throw new Error(`${path}: HTTP ${res.status}`);
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
}

const out: PurchaseWindows = { fetchedAt: new Date().toISOString(), days, windows: WINDOWS, heroes: {} };
let failed = 0;
for (const hero of data.heroes) {
  let rows: Row[];
  try {
    rows = await get(`/v1/analytics/item-stats?hero_id=${hero.id}&game_mode=normal&min_unix_timestamp=${since}&bucket=game_time_min`);
  } catch (e) {
    // Fonte fora do ar para um herói: segue sem ele (o app usa as mecânicas e diz que faltam dados).
    console.log(`${hero.name}: ${(e as Error).message}`);
    failed++;
    continue;
  }
  const byItem: Record<string, [number, number][]> = {};
  for (const r of rows) {
    const item = itemById.get(r.item_id);
    if (!item) continue;
    const cells = (byItem[item.className] ??= WINDOWS.map(() => [0, 0] as [number, number]));
    const cell = cells[windowIndex(r.bucket)]!;
    cell[0] += r.wins;
    cell[1] += r.matches;
  }
  out.heroes[String(hero.id)] = byItem;
  console.log(`${hero.name}: ${Object.keys(byItem).length} itens`);
}
await writeFile(join(root, "data", "snapshot", "windows.json"), JSON.stringify(out));
console.log(`Gravado data/snapshot/windows.json (${Object.keys(out.heroes).length} heróis${failed ? `, ${failed} sem dados` : ""}).`);
