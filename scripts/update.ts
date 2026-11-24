/**
 * Rotina de atualização por patch.
 *
 *   npm run update            baixa os dados novos, mostra o que mudou e roda a verificação
 *   npm run update -- --dry   só compara o snapshot atual com a API, sem gravar nada
 *
 * O relatório aponta o que precisa de atenção manual depois de um patch:
 * heróis e itens novos ou removidos, mudanças de preço e de atributos,
 * tipos de bônus que o motor ainda não conhece e correções manuais órfãs.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../src/data/load.ts";
import type { GameData, Item } from "../src/data/types.ts";
import { OVERRIDES } from "../src/interactions/overrides.ts";
import { IGNORED_PROVIDES, KNOWN_PROVIDES } from "../src/interactions/tagger.ts";

const API = "https://api.deadlock-api.com";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotDir = join(root, "data", "snapshot");
const dry = process.argv.includes("--dry");

const previous: GameData | null = existsSync(join(snapshotDir, "meta.json")) ? loadSnapshot() : null;

const info = (await (await fetch(`${API}/v1/assets/steam-info`)).json()) as { client_version?: number; version_date?: string };
const remote = Number(info.client_version ?? 0);
console.log(`Snapshot local: ${previous ? `patch ${previous.meta.clientVersion} (baixado em ${previous.meta.fetchedAt.slice(0, 10)})` : "nenhum"}`);
console.log(`API agora:      patch ${remote} (${info.version_date ?? "sem data"})`);

if (dry) {
  console.log(previous && previous.meta.clientVersion === remote ? "\nSem patch novo." : "\nHá dados novos. Rode `npm run update` para baixar.");
} else {
  // O snapshot roda em processo separado para reusar o script já testado.
  execFileSync(process.execPath, [join(root, "scripts", "snapshot.ts")], { stdio: "inherit", cwd: root });
  report(loadSnapshot());
}
matchDataAge(info.version_date);

/**
 * Idade dos dados de partidas. Eles não são baixados aqui: logo depois de um patch,
 * a janela de 14 a 30 dias ainda seria quase toda do patch anterior. O certo é
 * esperar alguns dias de partidas e então rodar cada comando.
 */
function matchDataAge(patchDate: string | undefined): void {
  const sources: [string, string, string][] = [
    ["stats.json", "npm run stats -- --refresh", "curva de souls, uso de itens, builds publicadas"],
    ["windows.json", "npm run windows -- --refresh", "winrate por janela de compra"],
    ["elite.json", "npm run elite -- --refresh", "itens e habilidades do elo alto"],
    ["wpa.json", "npm run wpa -- --refresh", "vitória acima do esperado"],
    ["timing.json", "npm run timing", "ritmo das compras (depois do wpa)"],
    ["fights.json", "npm run fights -- --refresh", "duração e tamanho das lutas"],
  ];
  const patchTime = patchDate ? Date.parse(patchDate) : NaN;
  console.log("\nDados de partidas (atualize alguns dias depois do patch, quando houver partidas suficientes):");
  for (const [file, command, what] of sources) {
    const path = join(snapshotDir, file);
    if (!existsSync(path)) {
      console.log(`  ${file.padEnd(13)} ausente — ${command} (${what})`);
      continue;
    }
    const fetched = Date.parse((JSON.parse(readFileSync(path, "utf8")) as { fetchedAt?: string }).fetchedAt ?? "");
    const days = Number.isFinite(fetched) ? Math.floor((Date.now() - fetched) / 86_400_000) : null;
    const old = Number.isFinite(patchTime) && Number.isFinite(fetched) && fetched < patchTime;
    console.log(`  ${file.padEnd(13)} ${days === null ? "sem data" : `${days} dia(s)`}${old ? ", anterior ao patch" : ""} — ${command} (${what})`);
  }
}

function report(current: GameData): void {

function section(title: string, lines: string[]): void {
  if (lines.length === 0) return;
  console.log(`\n${title} (${lines.length})`);
  for (const line of lines.slice(0, 40)) console.log(`  ${line}`);
  if (lines.length > 40) console.log(`  ... e mais ${lines.length - 40}`);
}

/** Resumo comparável dos números de um item. */
function itemFingerprint(item: Item): Record<string, number> {
  const out: Record<string, number> = { custo: item.cost, tier: item.tier };
  for (const [key, p] of Object.entries(item.properties)) out[key] = p.value;
  return out;
}

if (previous) {
  const names = (list: { name: string }[]) => new Set(list.map((x) => x.name));
  const added = (now: Set<string>, before: Set<string>) => [...now].filter((n) => !before.has(n)).sort();

  section("Heróis novos", added(names(current.heroes), names(previous.heroes)));
  section("Heróis removidos", added(names(previous.heroes), names(current.heroes)));
  section("Itens novos", added(names(current.items), names(previous.items)));
  section("Itens removidos", added(names(previous.items), names(current.items)));

  const before = new Map(previous.items.map((i) => [i.name, itemFingerprint(i)]));
  const changed: string[] = [];
  for (const item of current.items) {
    const old = before.get(item.name);
    if (!old) continue;
    const now = itemFingerprint(item);
    const diffs = [...new Set([...Object.keys(old), ...Object.keys(now)])]
      .filter((k) => old[k] !== now[k])
      .map((k) => `${k} ${old[k] ?? "—"} → ${now[k] ?? "—"}`);
    if (diffs.length > 0) changed.push(`${item.name}: ${diffs.slice(0, 4).join(", ")}${diffs.length > 4 ? ` (+${diffs.length - 4})` : ""}`);
  }
  section("Itens com números alterados", changed);

  const heroBefore = new Map(previous.heroes.map((h) => [h.name, JSON.stringify([h.start, h.perBoon, h.weapon, h.scaling])]));
  section(
    "Heróis com atributos ou arma alterados",
    current.heroes.filter((h) => heroBefore.has(h.name) && heroBefore.get(h.name) !== JSON.stringify([h.start, h.perBoon, h.weapon, h.scaling])).map((h) => h.name),
  );

  const abilityBefore = new Map(previous.abilities.map((a) => [a.className, JSON.stringify([a.properties, a.upgrades])]));
  section(
    "Habilidades alteradas",
    current.abilities.filter((a) => abilityBefore.has(a.className) && abilityBefore.get(a.className) !== JSON.stringify([a.properties, a.upgrades])).map((a) => a.name),
  );

  if (JSON.stringify(previous.shared) !== JSON.stringify(current.shared)) {
    console.log("\nTabelas gerais mudaram (níveis, bônus de investimento ou preços por tier). Confira data/snapshot/shared.json.");
  }
}

// --- O que precisa de atenção manual ---
const unknown = new Map<string, string[]>();
for (const item of current.items) {
  for (const p of Object.values(item.properties)) {
    const type = p.provides?.replace("MODIFIER_VALUE_", "");
    if (type && !KNOWN_PROVIDES.has(type) && !IGNORED_PROVIDES.has(type) && p.value !== 0) unknown.set(type, [...(unknown.get(type) ?? []), item.name]);
  }
}
section(
  "Tipos de bônus novos, que a etiquetagem não conhece (mapeie ou ignore em src/interactions/tagger.ts)",
  [...unknown.entries()].sort((a, b) => b[1].length - a[1].length).map(([type, items]) => `${type}: ${[...new Set(items)].slice(0, 3).join(", ")}`),
);

const allNames = new Set([...current.items.map((i) => i.name), ...current.abilities.map((a) => a.name)]);
section("Correções manuais órfãs (remova de src/interactions/overrides.ts)", Object.keys(OVERRIDES).filter((n) => !allNames.has(n)));

console.log(`\nSnapshot atualizado para o patch ${current.meta.clientVersion}. Rodando a verificação...`);
}
