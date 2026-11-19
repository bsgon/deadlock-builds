/**
 * Perfil das lutas medido nas partidas (ver scripts/fights.ts): duração da luta
 * (tempo até a morte depois do primeiro dano) e mistura de tipos de luta, usados
 * por todo o cálculo no lugar de valores escolhidos à mão.
 */
import type { ScenarioId } from "../combat/value.ts";

export interface DeathRow {
  t: number;
  victim: number;
  victimTeam: number;
  /** Slot do herói que matou; 0 quando foi tropa, torre ou chefe. */
  killer: number;
  x: number;
  y: number;
  /** Segundos entre o primeiro dano e a morte. */
  ttk: number;
}

export interface MatchDeaths {
  id: number;
  duration: number;
  deaths: DeathRow[];
}

export interface FightProfile {
  fetchedAt: string;
  matches: number;
  deaths: number;
  fights: number;
  /** Segundos entre o primeiro dano e a morte (mortes por herói). */
  timeToKill: { p25: number; median: number; p75: number };
  /** Parte das mortes por tamanho da luta (heróis envolvidos): 2, 3–5, 6+. */
  sizes: { duel: number; skirmish: number; teamfight: number };
  /** Parte das mortes em lutas de 3+ heróis em que as mortes ficam longe umas das outras. */
  spreadShare: number;
  /** Mistura de cenários usada nas jogadas (soma 1). */
  mix: Record<ScenarioId, number>;
  /** Cenários sem medida nas partidas, com peso assumido. */
  assumed: ScenarioId[];
}

/** Mortes a até 15 s da anterior e a até ~75 m do centro da luta são a mesma luta. */
export const CLUSTER_GAP_S = 15;
export const CLUSTER_RADIUS = 3000;
/** Luta com mortes a mais de ~45 m umas das outras: alvos espalhados. */
export const SPREAD_DISTANCE = 1800;
/**
 * Perseguição e mergulho não aparecem nos detalhes de morte (sem trajetória nem
 * quem iniciou): ficam com o peso que tinham na mistura escolhida à mão.
 */
export const ASSUMED: Partial<Record<ScenarioId, number>> = { chase: 0.1, dive: 0.15 };

const quantile = (sorted: number[], q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! : 0);
const round1 = (x: number) => Math.round(x * 10) / 10;

export function profileFromDeaths(matches: MatchDeaths[], fetchedAt: string): FightProfile {
  const ttk: number[] = [];
  let duel = 0;
  let skirmish = 0;
  let teamfight = 0;
  let spread = 0;
  let deaths = 0;
  let fights = 0;
  for (const m of matches) {
    const list = [...m.deaths].sort((a, b) => a.t - b.t);
    deaths += list.length;
    for (const d of list) if (d.killer > 0 && d.ttk > 0 && d.ttk < 90) ttk.push(d.ttk);
    let fight: DeathRow[] = [];
    const close = () => {
      if (!fight.length) return;
      const heroes = new Set(fight.flatMap((d) => (d.killer > 0 ? [d.victim, d.killer] : [d.victim])));
      // Morte só para tropa/torre, sem herói inimigo: não é luta entre heróis.
      if (fight.some((d) => d.killer > 0)) {
        // Cada luta pesa pelas mortes: é o que decide a partida, e a luta grande rende mais mortes.
        const n = heroes.size;
        const w = fight.length;
        fights++;
        if (n <= 2) duel += w;
        else if (n <= 5) skirmish += w;
        else teamfight += w;
        if (n >= 3) {
          let far = 0;
          for (const a of fight) for (const b of fight) far = Math.max(far, Math.hypot(a.x - b.x, a.y - b.y));
          if (far > SPREAD_DISTANCE) spread += w;
        }
      }
      fight = [];
    };
    for (const d of list) {
      const last = fight[fight.length - 1];
      if (last) {
        const cx = fight.reduce((s, f) => s + f.x, 0) / fight.length;
        const cy = fight.reduce((s, f) => s + f.y, 0) / fight.length;
        if (d.t - last.t > CLUSTER_GAP_S || Math.hypot(d.x - cx, d.y - cy) > CLUSTER_RADIUS) close();
      }
      fight.push(d);
    }
    close();
  }
  ttk.sort((a, b) => a - b);
  const weighted = duel + skirmish + teamfight;
  const share = (n: number) => (weighted ? n / weighted : 0);
  const sizes = { duel: share(duel), skirmish: share(skirmish), teamfight: share(teamfight) };
  const spreadShare = skirmish + teamfight ? spread / (skirmish + teamfight) : 0;
  // O que foi medido divide o peso que sobra depois dos cenários assumidos.
  const measured = 1 - Object.values(ASSUMED).reduce((s, v) => s + (v ?? 0), 0);
  const grouped = 1 - spreadShare;
  const mix: Record<ScenarioId, number> = {
    duel: measured * sizes.duel,
    skirmish: measured * sizes.skirmish * grouped,
    teamfight: measured * sizes.teamfight * grouped,
    spread: measured * (sizes.skirmish + sizes.teamfight) * spreadShare,
    chase: ASSUMED.chase ?? 0,
    dive: ASSUMED.dive ?? 0,
  };
  for (const k of Object.keys(mix) as ScenarioId[]) mix[k] = Math.round(mix[k] * 1000) / 1000;
  return {
    fetchedAt,
    matches: matches.length,
    deaths,
    fights,
    timeToKill: { p25: round1(quantile(ttk, 0.25)), median: round1(quantile(ttk, 0.5)), p75: round1(quantile(ttk, 0.75)) },
    sizes: { duel: round1(sizes.duel * 100) / 100, skirmish: round1(sizes.skirmish * 100) / 100, teamfight: round1(sizes.teamfight * 100) / 100 },
    spreadShare: Math.round(spreadShare * 1000) / 1000,
    mix,
    assumed: Object.keys(ASSUMED) as ScenarioId[],
  };
}
