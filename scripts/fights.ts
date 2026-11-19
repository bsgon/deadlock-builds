/**
 * Perfil das lutas nas partidas reais (deadlock-api.com, /v1/matches/metadata com
 * detalhes de morte): quanto tempo o alvo leva para morrer depois do primeiro dano
 * e quantos heróis participam de cada luta. Substitui a mistura de tipos de luta
 * escolhida à mão por uma média medida.
 *
 *   npm run fights [-- --refresh] [-- --pages=10]
 *
 * Lutas: mortes da mesma partida a até CLUSTER_GAP_S segundos da anterior e a até
 * CLUSTER_RADIUS unidades do centro da luta. Participantes = quem morreu + quem
 * matou (a API não dá assistências, então é um limite inferior). Saída:
 * data/snapshot/fights.json (as partidas compactadas ficam em data/raw/fights).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { profileFromDeaths, type MatchDeaths } from "../src/meta/fights.ts";

const API = "https://api.deadlock-api.com/v1/matches/metadata";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rawDir = join(root, "data", "raw", "fights");
const cacheFile = join(rawDir, "deaths.json");
const outFile = join(root, "data", "snapshot", "fights.json");
const refresh = process.argv.includes("--refresh");
const pagesArg = process.argv.find((a) => a.startsWith("--pages="));
const PAGES = pagesArg ? Number(pagesArg.split("=")[1]) : 10;
const PAGE_SIZE = 200;

interface ApiDeath {
  game_time_s: number;
  killer_player_slot: number;
  death_pos: [number, number, number];
  time_to_kill_s: number;
}
interface ApiMatch {
  match_id: number;
  duration_s: number;
  players: { player_slot: number; team: number; death_details?: ApiDeath[] }[];
}

async function download(): Promise<MatchDeaths[]> {
  const out: MatchDeaths[] = [];
  let maxId: number | undefined;
  for (let page = 0; page < PAGES; page++) {
    const params = new URLSearchParams({
      include_info: "true",
      include_player_info: "true",
      include_player_death_details: "true",
      game_mode: "normal",
      limit: String(PAGE_SIZE),
      order_by: "match_id",
      order_direction: "desc",
      ...(maxId ? { max_match_id: String(maxId - 1) } : {}),
    });
    const res = await fetch(`${API}?${params}`);
    if (!res.ok) throw new Error(`metadata: HTTP ${res.status}`);
    const matches = (await res.json()) as ApiMatch[];
    if (matches.length === 0) break;
    for (const m of matches) {
      const team = new Map(m.players.map((p) => [p.player_slot, p.team]));
      out.push({
        id: m.match_id,
        duration: m.duration_s,
        deaths: m.players.flatMap((p) =>
          (p.death_details ?? []).map((d) => ({
            t: d.game_time_s,
            victim: p.player_slot,
            victimTeam: p.team,
            killer: team.has(d.killer_player_slot) ? d.killer_player_slot : 0,
            x: Math.round(d.death_pos[0]),
            y: Math.round(d.death_pos[1]),
            ttk: Math.round(d.time_to_kill_s * 10) / 10,
          })),
        ),
      });
    }
    maxId = Math.min(...matches.map((m) => m.match_id));
    process.stdout.write(`página ${page + 1}/${PAGES}: ${out.length} partidas\n`);
    await new Promise((r) => setTimeout(r, 1500)); // respeita o limite de requisições da API
  }
  return out;
}

mkdirSync(rawDir, { recursive: true });
const matches: MatchDeaths[] = !refresh && existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : await download();
writeFileSync(cacheFile, JSON.stringify(matches));
const profile = profileFromDeaths(matches, new Date().toISOString());
writeFileSync(outFile, JSON.stringify(profile, null, 1));
console.log(`\n${profile.matches} partidas, ${profile.deaths} mortes, ${profile.fights} lutas`);
console.log(`Tempo até a morte: p25 ${profile.timeToKill.p25} s, mediana ${profile.timeToKill.median} s, p75 ${profile.timeToKill.p75} s`);
console.log(`Lutas: ${Object.entries(profile.sizes).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(", ")}; espalhadas ${(profile.spreadShare * 100).toFixed(1)}%`);
console.log(`Mistura: ${Object.entries(profile.mix).map(([k, v]) => `${k} ${(v * 100).toFixed(1)}%`).join(", ")}`);
console.log(`Gravado ${outFile}`);
