/**
 * Vitória acima do esperado por compra (nosso "WPA"), medida em partidas reais
 * do deadlock-api.com por `npm run wpa` e gravada em data/snapshot/wpa.json.
 *
 * O winrate por janela (windows.ts) compara itens comprados no mesmo minuto, mas
 * não sabe se quem comprou estava ganhando. Aqui o estado da partida na hora da
 * compra entra no cálculo:
 *
 *   1. A série de patrimônio de cada jogador vem do `net_worth_at_buy` de cada
 *      compra; o patrimônio do time num instante é a soma interpolada.
 *   2. Um modelo logístico estima P(vitória | vantagem de patrimônio, minuto),
 *      ajustado nas próprias partidas.
 *   3. Cada compra vale resultado − P(vitória no momento da compra): positivo
 *      quando o time foi melhor do que o estado da partida previa.
 *   4. O WPA do item é a média disso. Comparado com os outros itens do mesmo
 *      tier do herói, separa o item de "quem compra está ganhando".
 *
 * Não é o mesmo número do buildlocker.gg (que mede a variação da probabilidade
 * depois da compra), mas corrige o mesmo viés.
 */
import type { GameData, Item } from "../data/types.ts";
import { MIN_PRIOR_MATCHES, PRIOR_SD, type TierPrior } from "./windows.ts";

// ---------------------------------------------------------------------------
// Partidas compactadas (o que o script guarda de cada partida)

export interface CompactPlayer {
  hero: number;
  /** 0 ou 1. */
  team: number;
  /** Instantes (s) e patrimônio nesses instantes, em ordem; vêm das compras e upgrades. */
  t: number[];
  nw: number[];
  /** Primeira compra de cada item de loja: [instante em s, id do item]. */
  buys: [number, number][];
}

export interface CompactMatch {
  id: number;
  /** Time vencedor (0 ou 1). */
  winner: number;
  duration: number;
  players: CompactPlayer[];
}

/** Patrimônio do jogador no instante t: interpolação linear; antes do primeiro ponto, reta desde zero; depois do último, mantém. */
export function worthAt(p: CompactPlayer, t: number): number {
  const { t: ts, nw } = p;
  if (ts.length === 0) return 0;
  if (t <= ts[0]!) return ts[0]! > 0 ? (nw[0]! * Math.max(0, t)) / ts[0]! : nw[0]!;
  const last = ts.length - 1;
  if (t >= ts[last]!) return nw[last]!;
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid]! <= t) lo = mid;
    else hi = mid;
  }
  const span = ts[hi]! - ts[lo]!;
  return span > 0 ? nw[lo]! + ((t - ts[lo]!) / span) * (nw[hi]! - nw[lo]!) : nw[hi]!;
}

/** Patrimônio do time e do adversário no instante t. */
export function teamWorth(m: CompactMatch, team: number, t: number): { own: number; enemy: number } {
  let own = 0;
  let enemy = 0;
  for (const p of m.players) {
    const w = worthAt(p, t);
    if (p.team === team) own += w;
    else enemy += w;
  }
  return { own, enemy };
}

// ---------------------------------------------------------------------------
// Modelo de vitória

/**
 * Atributos do estado da partida do ponto de vista de um time. Todos trocam de
 * sinal quando o ponto de vista troca, então o modelo não tem intercepto e
 * P(time A) + P(time B) = 1 por construção.
 */
export function features(own: number, enemy: number, seconds: number): [number, number, number] {
  const lead = own - enemy;
  const rel = lead / Math.max(1, own + enemy);
  const minute = Math.min(seconds / 60, 45);
  return [rel, (rel * minute) / 15, lead / 10_000];
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export const winProbability = (coef: number[], f: number[]): number => sigmoid(f.reduce((s, x, i) => s + x * coef[i]!, 0));

/** Regressão logística sem intercepto por Newton-Raphson, com uma regularização mínima para estabilidade. */
export function fitLogistic(xs: number[][], ys: number[], iterations = 25, ridge = 1e-6): number[] {
  const k = xs[0]?.length ?? 0;
  let w = new Array<number>(k).fill(0);
  for (let it = 0; it < iterations; it++) {
    const g = new Array<number>(k).fill(0);
    const H = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let n = 0; n < xs.length; n++) {
      const x = xs[n]!;
      const p = winProbability(w, x);
      const r = p * (1 - p);
      for (let i = 0; i < k; i++) {
        g[i]! += (p - ys[n]!) * x[i]!;
        for (let j = 0; j < k; j++) H[i]![j]! += r * x[i]! * x[j]!;
      }
    }
    for (let i = 0; i < k; i++) {
      g[i]! += ridge * w[i]!;
      H[i]![i]! += ridge;
    }
    const step = solve(H, g);
    w = w.map((v, i) => v - step[i]!);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  return w;
}

/** Resolve A x = b por eliminação de Gauss (sistemas pequenos). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[pivot]![c]!)) pivot = r;
    [M[c], M[pivot]] = [M[pivot]!, M[c]!];
    const d = M[c]![c]! || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / d;
      for (let j = c; j <= n; j++) M[r]![j]! -= f * M[c]![j]!;
    }
  }
  return M.map((row, i) => row[n]! / (row[i]! || 1e-12));
}

/** Estados de treino: o time 0 a cada minuto, do minuto 3 até 30 s antes do fim. */
export function trainingSet(matches: CompactMatch[]): { xs: number[][]; ys: number[] } {
  const xs: number[][] = [];
  const ys: number[] = [];
  for (const m of matches) {
    for (let t = 180; t <= m.duration - 30; t += 60) {
      const { own, enemy } = teamWorth(m, 0, t);
      xs.push(features(own, enemy, t));
      ys.push(m.winner === 0 ? 1 : 0);
    }
  }
  return { xs, ys };
}

// ---------------------------------------------------------------------------
// Agregação por item

/** Probabilidade de vitória a partir da qual o time conta como "à frente" (e 1 − isso, "atrás"). */
export const AHEAD_P = 0.55;

/** [n, Σr, Σr², n à frente, Σr à frente, n atrás, Σr atrás, Σ minuto] por item. */
export type WpaCell = [number, number, number, number, number, number, number, number];

export interface WpaStats {
  fetchedAt: string;
  days: number;
  matches: number;
  purchases: number;
  /** Coeficientes do modelo (ver `features`). */
  coef: number[];
  /** Qualidade do modelo em partidas fora do ajuste: Brier e log loss (o chute de 50% dá 0,25 e 0,693). */
  brier: number;
  logLoss: number;
  /** heroId → className → célula. */
  heroes: Record<string, Record<string, WpaCell>>;
}

/** Soma uma compra na célula (cria a célula quando falta). */
export function addPurchase(cells: Record<string, WpaCell>, className: string, residual: number, p: number, seconds: number): void {
  const c = (cells[className] ??= [0, 0, 0, 0, 0, 0, 0, 0]);
  c[0] += 1;
  c[1] += residual;
  c[2] += residual * residual;
  if (p >= AHEAD_P) {
    c[3] += 1;
    c[4] += residual;
  } else if (p <= 1 - AHEAD_P) {
    c[5] += 1;
    c[6] += residual;
  }
  c[7] += seconds / 60;
}

/** Resíduos das compras de uma partida: resultado − P(vitória no momento da compra). */
export function purchaseResiduals(m: CompactMatch, coef: number[], visit: (hero: number, itemId: number, residual: number, p: number, seconds: number) => void): void {
  for (const player of m.players) {
    const won = player.team === m.winner ? 1 : 0;
    for (const [t, itemId] of player.buys) {
      const { own, enemy } = teamWorth(m, player.team, t);
      const p = winProbability(coef, features(own, enemy, t));
      visit(player.hero, itemId, won - p, p, t);
    }
  }
}

// ---------------------------------------------------------------------------
// Leitura no app

/** Peso, em compras, da média geral do item ao estimar o valor de um herói. */
export const SHRINK_PURCHASES = 200;
/** Diferença mínima (em pontos percentuais) entre atrás e à frente para chamar de virada ou win-more. */
const LEAN_PP = 2;
const MIN_SIDE = 100;

export interface ItemWpa {
  /** Vitória acima do esperado nas compras do item com o herói, em pp (já com o peso da média geral). */
  wpa: number;
  /** O mesmo contra a média dos itens do mesmo tier do herói, em pp. */
  relative: number;
  /** Meio intervalo de 95% de `wpa`, em pp (compras de um mesmo time não são independentes: é um piso). */
  margin: number;
  purchases: number;
  minute: number;
  /** Comprado atrás vs à frente no placar de patrimônio, em pp (null com pouca amostra). */
  behind: number | null;
  ahead: number | null;
  lean: "comeback" | "win-more" | null;
}

const globalCache = new WeakMap<WpaStats, Map<string, WpaCell>>();

/** Soma de todos os heróis por item. */
function globalCells(stats: WpaStats): Map<string, WpaCell> {
  let out = globalCache.get(stats);
  if (out) return out;
  out = new Map();
  for (const cells of Object.values(stats.heroes)) {
    for (const [cls, c] of Object.entries(cells)) {
      const g = out.get(cls) ?? [0, 0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 8; i++) g[i] = g[i]! + c[i]!;
      out.set(cls, g as WpaCell);
    }
  }
  globalCache.set(stats, out);
  return out;
}

/** Média com peso da média geral: (Σ do herói + K × média geral) / (n do herói + K). */
const shrink = (sum: number, n: number, prior: number, k = SHRINK_PURCHASES) => (sum + k * prior) / (n + k);

function rawWpa(stats: WpaStats, heroId: number, className: string): { wpa: number; cell: WpaCell; global: WpaCell } | null {
  const cell = stats.heroes[String(heroId)]?.[className];
  const global = globalCells(stats).get(className);
  if (!cell || !global || global[0] === 0) return null;
  return { wpa: shrink(cell[1], cell[0], global[1] / global[0]), cell, global };
}

const baselineCache = new WeakMap<WpaStats, Map<string, number>>();

/** Média (ponderada pelas compras) do WPA dos itens de um tier com o herói. */
function tierBaseline(data: GameData, stats: WpaStats, heroId: number, tier: number): number {
  let cache = baselineCache.get(stats);
  if (!cache) baselineCache.set(stats, (cache = new Map()));
  const key = `${heroId}:${tier}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let sum = 0;
  let n = 0;
  for (const item of data.items) {
    if (item.tier !== tier) continue;
    const r = rawWpa(stats, heroId, item.className);
    if (!r) continue;
    sum += r.wpa * r.cell[0];
    n += r.cell[0];
  }
  const out = n > 0 ? sum / n : 0;
  cache.set(key, out);
  return out;
}

/**
 * O WPA no mesmo formato do peso por janela (windows.ts/tierPrior), para o
 * otimizador: Δ = vitória acima do esperado contra o mesmo tier do herói,
 * encolhido para zero pela incerteza com a mesma priori N(0, PRIOR_SD²).
 */
export function wpaPrior(data: GameData, heroId: number, item: Item): TierPrior | null {
  const w = itemWpa(data, heroId, item);
  if (!w || w.purchases < MIN_PRIOR_MATCHES) return null;
  const se = w.margin / 1.96;
  return {
    source: "wpa",
    window: `${Math.round(w.minute)} min`,
    matches: w.purchases,
    delta: w.relative,
    margin: w.margin,
    shrunk: (w.relative * PRIOR_SD ** 2) / (PRIOR_SD ** 2 + se ** 2),
  };
}

/**
 * Viés típico do winrate por janela, em pp: quem compra na janela pode já estar
 * ganhando. Entra como variância extra da janela ao combinar com o WPA.
 */
export const WINDOW_BIAS_SD = 2;

/**
 * Combina as duas fontes pela precisão. A janela tem amostra grande (todas as partidas
 * do período) mas é enviesada pelo estado da partida; o WPA não tem esse viés, mas
 * vem de menos partidas. Cada Δ pesa 1/variância, com WINDOW_BIAS_SD² somado à
 * variância da janela; o resultado é encolhido para zero como os outros.
 */
export function blendPriors(window: TierPrior | null, wpa: TierPrior | null): TierPrior | null {
  if (!window || !wpa) return window ?? wpa;
  const vWin = (window.margin / 1.96) ** 2 + WINDOW_BIAS_SD ** 2;
  const vWpa = (wpa.margin / 1.96) ** 2;
  const delta = (window.delta / vWin + wpa.delta / vWpa) / (1 / vWin + 1 / vWpa);
  const v = 1 / (1 / vWin + 1 / vWpa);
  return {
    source: "blend",
    window: window.window,
    matches: window.matches,
    delta,
    margin: 1.96 * Math.sqrt(v),
    shrunk: (delta * PRIOR_SD ** 2) / (PRIOR_SD ** 2 + v),
  };
}

/** WPA do item com o herói; null sem wpa.json ou sem compras do item. */
export function itemWpa(data: GameData, heroId: number, item: Item): ItemWpa | null {
  const stats = data.wpa;
  if (!stats) return null;
  const r = rawWpa(stats, heroId, item.className);
  if (!r) return null;
  const { cell, global } = r;
  const n = cell[0];
  const mean = n > 0 ? cell[1] / n : 0;
  const variance = n > 1 ? Math.max(0, cell[2] / n - mean * mean) : 0.25;
  const side = (count: number, sum: number, gCount: number, gSum: number) => (count >= MIN_SIDE && gCount > 0 ? shrink(sum, count, gSum / gCount) * 100 : null);
  const ahead = side(cell[3], cell[4], global[3], global[4]);
  const behind = side(cell[5], cell[6], global[5], global[6]);
  const lean = ahead !== null && behind !== null && Math.abs(behind - ahead) >= LEAN_PP ? (behind > ahead ? "comeback" : "win-more") : null;
  return {
    wpa: r.wpa * 100,
    relative: (r.wpa - tierBaseline(data, stats, heroId, item.tier)) * 100,
    margin: 196 * Math.sqrt(variance / (n + SHRINK_PURCHASES)),
    purchases: n,
    minute: n > 0 ? cell[7] / n : global[7] / global[0],
    behind,
    ahead,
    lean,
  };
}
