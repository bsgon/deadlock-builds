/** Carrega o snapshot normalizado do disco (uso em Node: testes e scripts). */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameData } from "./types.ts";
import { withoutBrawlItems } from "./playable.ts";
import { applyFightProfile } from "../optimizer/metrics.ts";

const defaultDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "snapshot");

export function loadSnapshot(dir: string = defaultDir): GameData {
  const read = (file: string) => JSON.parse(readFileSync(join(dir, file), "utf8"));
  // Itens de tier 5 são do modo Brawl, que o projeto não cobre.
  const data = withoutBrawlItems({
    meta: read("meta.json"),
    shared: read("shared.json"),
    heroes: read("heroes.json"),
    abilities: read("abilities.json"),
    items: read("items.json"),
    // Estatísticas de partidas são opcionais: só existem depois de "npm run stats".
    ...(existsSync(join(dir, "stats.json")) ? { stats: read("stats.json") } : {}),
    // Interações da wiki são opcionais: só existem depois de "npm run knowledge -- merge".
    ...(existsSync(join(dir, "interactions.json")) ? { knowledge: read("interactions.json") } : {}),
    ...(existsSync(join(dir, "theories.json")) ? { theories: read("theories.json") } : {}),
    ...(existsSync(join(dir, "windows.json")) ? { windows: read("windows.json") } : {}),
    ...(existsSync(join(dir, "fights.json")) ? { fights: read("fights.json") } : {}),
    ...(existsSync(join(dir, "elite.json")) ? { elite: read("elite.json") } : {}),
    ...(existsSync(join(dir, "wpa.json")) ? { wpa: read("wpa.json") } : {}),
    ...(existsSync(join(dir, "timing.json")) ? { timing: read("timing.json") } : {}),
    ...(existsSync(join(dir, "sales.json")) ? { sales: read("sales.json") } : {}),
    ...(existsSync(join(dir, "i18n-en.json")) ? { translations: read("i18n-en.json") } : {}),
  });
  // Duração e tipos de luta medidos nas partidas valem para todo o cálculo.
  applyFightProfile(data.fights);
  return data;
}
