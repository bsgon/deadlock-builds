/**
 * Baixa os dados do deadlock-api.com, guarda o bruto em data/raw/ (fora do git)
 * e grava o snapshot normalizado em data/snapshot/.
 *
 *   npm run snapshot           baixa e normaliza
 *   npm run snapshot:offline   só normaliza de novo o bruto já baixado
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalize, type RawSnapshot } from "../src/data/normalize.ts";

const API = "https://api.deadlock-api.com";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = join(root, "data", "raw");
const outDir = join(root, "data", "snapshot");

const SOURCES = {
  steamInfo: "/v1/assets/steam-info",
  heroes: "/v1/assets/heroes?only_active=true",
  items: "/v1/assets/items",
  generic: "/v1/assets/generic-data",
} as const;

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(API + path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

async function download(): Promise<void> {
  await mkdir(rawDir, { recursive: true });
  for (const [name, path] of Object.entries(SOURCES)) {
    process.stdout.write(`baixando ${path} ... `);
    const body = JSON.stringify(await fetchJson(path));
    await writeFile(join(rawDir, `${name}.json`), body);
    console.log(`${(body.length / 1024).toFixed(0)} KB`);
  }
  await writeFile(join(rawDir, "fetched-at.txt"), new Date().toISOString());
}

async function readRaw(name: string): Promise<unknown> {
  return JSON.parse(await readFile(join(rawDir, `${name}.json`), "utf8"));
}

const offline = process.argv.includes("--offline");
if (!offline) await download();

const raw = {
  steamInfo: await readRaw("steamInfo"),
  heroes: await readRaw("heroes"),
  items: await readRaw("items"),
  generic: await readRaw("generic"),
} as RawSnapshot;
const fetchedAt = (await readFile(join(rawDir, "fetched-at.txt"), "utf8")).trim();

const data = normalize(raw, fetchedAt);
await mkdir(outDir, { recursive: true });
const files: Record<string, unknown> = {
  "meta.json": data.meta,
  "shared.json": data.shared,
  "heroes.json": data.heroes,
  "abilities.json": data.abilities,
  "items.json": data.items,
};
for (const [file, content] of Object.entries(files)) {
  const body = JSON.stringify(content, null, 1);
  await writeFile(join(outDir, file), body + "\n");
  console.log(`gravado data/snapshot/${file} (${(body.length / 1024).toFixed(0)} KB)`);
}
console.log(
  `patch ${data.meta.clientVersion} (${data.meta.versionDate}): ${data.meta.counts.heroes} heróis, ` +
    `${data.meta.counts.abilities} habilidades, ${data.meta.counts.items} itens`,
);
