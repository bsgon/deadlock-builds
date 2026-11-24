/**
 * Ritmo real das compras, medido nas partidas já baixadas (data/raw/wpa) por
 * `npm run timing` e gravado em data/snapshot/timing.json: em que minuto cada herói
 * faz a primeira compra de cada tier e quanto espera entre uma compra e a seguinte.
 *
 * Serve para a ordem de compra: quando um tier pode entrar e por quanto tempo vale
 * juntar souls. A espera é em minutos porque 1.600 souls demoram ~3 min no começo
 * da partida e ~1 min no fim.
 */
import type { GameData } from "../data/types.ts";

/** Fases pelo minuto em que a espera começa: [início, fim). */
export const PACE_PHASES: [number, number | null][] = [
  [0, 5],
  [5, 10],
  [10, 15],
  [15, null],
];

export interface HeroPace {
  players: number;
  /** Minuto da primeira compra dos tiers 1 a 4: [p10, p50, p75]. */
  first: [number, number, number][];
  /** Espera entre compras por fase, em minutos: [p50, p90]. */
  wait: [number, number][];
}

export interface PaceStats {
  fetchedAt: string;
  matches: number;
  /** Todos os heróis juntos: usado quando o herói tem pouca amostra. */
  overall: HeroPace;
  heroes: Record<string, HeroPace>;
}

/** Jogadores mínimos para usar o ritmo do próprio herói. */
export const MIN_PACE_PLAYERS = 500;

export const pacePhase = (minute: number) => {
  const i = PACE_PHASES.findIndex(([from, to]) => minute >= from && (to === null || minute < to));
  return i < 0 ? PACE_PHASES.length - 1 : i;
};

/** Ritmo do herói (ou o geral, com pouca amostra); null sem timing.json. */
export function heroPace(data: GameData, heroId: number): HeroPace | null {
  if (!data.timing) return null;
  const own = data.timing.heroes[String(heroId)];
  return own && own.players >= MIN_PACE_PLAYERS ? own : data.timing.overall;
}

/** Por quanto tempo, a partir de `minute`, os jogadores esperam pela próxima compra (p90); null sem dados. */
export function maxWaitMinutes(pace: HeroPace | null, minute: number): number | null {
  return pace ? pace.wait[pacePhase(minute)]![1] : null;
}
