/**
 * Como os jogadores vendem itens, medido em partidas reais por `npm run sales` e
 * gravado em data/snapshot/sales.json: o que cada herói vende, por quanto tempo fica
 * com o item, em que minuto passa a usar mais de 9 slots e se as trocas sugeridas pela
 * comunidade (teorias "late-swap") dão resultado.
 *
 * `sold_time_s` da API marca quando o item saiu do inventário, o que inclui componente
 * consumido por um upgrade e compra desfeita na loja. As duas coisas são tiradas daqui;
 * a marca de componente (flags = 1) foi inferida dos dados, não é documentada.
 */
import type { GameData, Item } from "../data/types.ts";
import { componentTree } from "../engine/inventory.ts";
import { BASE_ITEM_SLOTS, MAX_ITEM_SLOTS, SELL_REFUND } from "../engine/rules.ts";
import type { Theory } from "../knowledge/theories.ts";
import { features, fitLogistic, teamWorth, trainingSet, winProbability, type CompactMatch } from "./wpa.ts";

/** Compra: item, instante da compra e da saída em s (0 = ficou até o fim), flags, patrimônio. */
export type SaleBuy = [id: number, bought: number, sold: number, flags: number, worth: number];

export interface SaleMatch {
  id: number;
  winner: number;
  duration: number;
  /** Elo médio da partida (101+ = Ascendant 1), 0 sem dado. */
  badge: number;
  players: { hero: number; team: number; buys: SaleBuy[] }[];
}

export interface SoldItem {
  /** Vendas do item pelo herói. */
  sales: number;
  /** Compras do item pelo herói que chegaram ao inventário (sem contar as desfeitas). */
  bought: number;
  /** Posse até a venda, em minutos: [p10, p50]. */
  held: [number, number];
  /** Minuto mediano da venda. */
  minute: number;
}

export interface HeroSales {
  players: number;
  /** Vendas por jogador. */
  perPlayer: number;
  /** Souls perdidos em vendas por jogador. */
  lost: number;
  /** Posse até a venda, em minutos: [p10, p50]. */
  held: [number, number];
  /** Minuto em que metade dos jogadores que chegam lá passa a ter 10, 11 e 12 itens (null com pouca amostra). */
  slots: (number | null)[];
  /** Itens vendidos, por class_name. */
  items: Record<string, SoldItem>;
}

export interface SwapEvidence {
  heroId: number;
  /** class_name: vendido e comprado. */
  sold: string;
  bought: string;
  /** Trocas vistas. */
  swaps: number;
  /** Vitória acima do esperado de quem troca, menos a de quem compra o item sem a venda, em pp. */
  lift: number;
  /** Meia-largura do intervalo de 95%, em pp. */
  margin: number;
  /** Minuto mediano da troca. */
  minute: number;
  /** Posse mediana do vendido, em minutos. */
  held: number;
}

export interface SalesStats {
  fetchedAt: string;
  matches: number;
  overall: HeroSales;
  heroes: Record<string, HeroSales>;
  swaps: SwapEvidence[];
}

/** Saída em menos disto conta como compra desfeita na loja (devolução total). */
const UNDO_SECONDS = 45;
const UPGRADED = 1;
/** A venda e a compra contam como uma troca se acontecem a até isto uma da outra. */
const SWAP_WINDOW_SECONDS = 90;
/** Vendas mínimas para um item entrar na tabela do herói. */
const MIN_ITEM_SALES = 20;
const MIN_SLOT_PLAYERS = 50;

export type Exit = "kept" | "undone" | "upgraded" | "sold";

/** Como a compra saiu do inventário. `buys` = todas as compras do jogador. */
export function exitOf(data: GameData, shop: Map<number, Item>, buy: SaleBuy, buys: SaleBuy[]): Exit {
  const [id, bought, sold, flags] = buy;
  if (!sold) return "kept";
  const item = shop.get(id);
  if (!item || flags & UPGRADED) return "upgraded";
  if (buys.some((b) => Math.abs(b[1] - sold) <= 1 && shop.has(b[0]) && componentTree(data, shop.get(b[0])!).has(item.className))) return "upgraded";
  return sold - bought < UNDO_SECONDS ? "undone" : "sold";
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const sorted = Float64Array.from(xs).sort();
  return r1(sorted[Math.floor((sorted.length - 1) * q)]!);
};

interface Samples {
  players: number;
  lost: number;
  held: number[];
  slots: number[][];
  bought: Map<string, number>;
  items: Map<string, { held: number[]; minute: number[] }>;
}
const empty = (): Samples => ({ players: 0, lost: 0, held: [], slots: [[], [], []], bought: new Map(), items: new Map() });

function summary(s: Samples): HeroSales {
  return {
    players: s.players,
    perPlayer: Math.round((100 * s.held.length) / Math.max(1, s.players)) / 100,
    lost: Math.round(s.lost / Math.max(1, s.players)),
    held: [quantile(s.held, 0.1), quantile(s.held, 0.5)],
    slots: s.slots.map((x) => (x.length >= MIN_SLOT_PLAYERS ? quantile(x, 0.5) : null)),
    items: Object.fromEntries(
      [...s.items]
        .filter(([, v]) => v.held.length >= MIN_ITEM_SALES)
        .sort((a, b) => b[1].held.length - a[1].held.length)
        .map(([cls, v]) => [cls, { sales: v.held.length, bought: s.bought.get(cls) ?? 0, held: [quantile(v.held, 0.1), quantile(v.held, 0.5)], minute: quantile(v.minute, 0.5) }]),
    ),
  };
}

/** Partida no formato do modelo de vitória (wpa.ts). */
function asCompact(m: SaleMatch): CompactMatch {
  return {
    id: m.id,
    winner: m.winner,
    duration: m.duration,
    players: m.players.map((p) => {
      const t: number[] = [];
      const nw: number[] = [];
      for (const [, at, , , worth] of p.buys) {
        if (t.length && t[t.length - 1] === at) nw[nw.length - 1] = worth;
        else {
          t.push(at);
          nw.push(worth);
        }
      }
      return { hero: p.hero, team: p.team, t, nw, buys: p.buys.map((b) => [b[1], b[0]]) };
    }),
  };
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const variance = (xs: number[]) => {
  const m = mean(xs);
  return xs.length > 1 ? xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1) : 0;
};

export function measureSales(data: GameData, matches: SaleMatch[], theories: Theory[]): SalesStats {
  const shop = new Map(data.items.map((i) => [i.id, i]));
  const overall = empty();
  const heroes = new Map<number, Samples>();
  const compact = matches.map(asCompact);
  const { xs, ys } = trainingSet(compact);
  const coef = xs.length ? fitLogistic(xs, ys) : [0, 0, 0];

  // Pares (herói, vendido, comprado) que as teorias citam.
  const pairs = new Map<string, { heroId: number; sold: string; bought: string; swap: number[]; plain: number[]; minute: number[]; held: number[] }>();
  for (const th of theories)
    if (th.kind === "late-swap" && th.items.length >= 2)
      for (const bought of th.items.slice(1)) pairs.set(`${th.heroId}|${th.items[0]}|${bought}`, { heroId: th.heroId, sold: th.items[0]!, bought, swap: [], plain: [], minute: [], held: [] });
  const byHero = new Map<number, typeof pairs extends Map<string, infer V> ? V[] : never>();
  for (const p of pairs.values()) byHero.set(p.heroId, [...(byHero.get(p.heroId) ?? []), p]);

  matches.forEach((m, mi) => {
    for (const p of m.players) {
      let own = heroes.get(p.hero);
      if (!own) heroes.set(p.hero, (own = empty()));
      const exits = p.buys.map((b) => exitOf(data, shop, b, p.buys));
      const worth = Math.max(0, ...p.buys.map((b) => b[4]));
      if (worth <= 0) continue;
      // Itens no inventário ao longo do tempo: entradas e saídas em ordem (saída primeiro no mesmo instante).
      const moves = p.buys
        .flatMap((b, i): [number, number][] => (exits[i] === "undone" ? [] : b[2] ? [[b[1], 1], [b[2], -1]] : [[b[1], 1]]))
        .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const reached: (number | null)[] = [null, null, null];
      let count = 0;
      for (const [t, d] of moves) {
        count += d;
        for (let k = 0; k < reached.length; k++) if (reached[k] === null && count >= BASE_ITEM_SLOTS + 1 + k && BASE_ITEM_SLOTS + 1 + k <= MAX_ITEM_SLOTS) reached[k] = t / 60;
      }
      for (const s of [own, overall]) {
        s.players++;
        reached.forEach((t, k) => t !== null && s.slots[k]!.push(t));
        p.buys.forEach((b, i) => {
          const item = shop.get(b[0]);
          if (!item || exits[i] === "undone") return;
          s.bought.set(item.className, (s.bought.get(item.className) ?? 0) + 1);
          if (exits[i] !== "sold") return;
          const held = (b[2] - b[1]) / 60;
          s.held.push(held);
          s.lost += item.cost * (1 - SELL_REFUND);
          let cell = s.items.get(item.className);
          if (!cell) s.items.set(item.className, (cell = { held: [], minute: [] }));
          cell.held.push(held);
          cell.minute.push(b[2] / 60);
        });
      }
      for (const pair of byHero.get(p.hero) ?? []) {
        const buy = p.buys.findIndex((b, i) => exits[i] !== "undone" && shop.get(b[0])?.className === pair.bought);
        if (buy < 0) continue;
        const at = p.buys[buy]![1];
        // Só entra na comparação quem já tinha o item vendido: os dois lados partem do mesmo inventário.
        const had = p.buys.findIndex((b, i) => exits[i] !== "undone" && shop.get(b[0])?.className === pair.sold && b[1] < at);
        if (had < 0 || exits[had] === "upgraded") continue;
        // Nem quem ainda tinha slot livre: vender só é escolha com o inventário cheio.
        const others = p.buys.filter((b, i) => i !== buy && i !== had && exits[i] !== "undone" && b[1] < at && (!b[2] || b[2] > at)).length;
        if (others + 1 < BASE_ITEM_SLOTS) continue;
        const { own: mine, enemy } = teamWorth(compact[mi]!, p.team, at);
        const residual = (m.winner === p.team ? 1 : 0) - winProbability(coef, features(mine, enemy, at));
        const soldAt = p.buys[had]![2];
        if (exits[had] === "sold" && Math.abs(soldAt - at) <= SWAP_WINDOW_SECONDS) {
          pair.swap.push(residual);
          pair.minute.push(at / 60);
          pair.held.push((soldAt - p.buys[had]![1]) / 60);
        } else if (exits[had] === "kept" || soldAt > at) pair.plain.push(residual);
      }
    }
  });

  return {
    fetchedAt: new Date().toISOString(),
    matches: matches.length,
    overall: summary(overall),
    heroes: Object.fromEntries([...heroes].sort((a, b) => a[0] - b[0]).map(([id, s]) => [id, summary(s)])),
    swaps: [...pairs.values()].map((p) => ({
      heroId: p.heroId,
      sold: p.sold,
      bought: p.bought,
      swaps: p.swap.length,
      lift: p.swap.length && p.plain.length ? r1((mean(p.swap) - mean(p.plain)) * 100) : 0,
      margin: p.swap.length > 1 && p.plain.length > 1 ? r1(196 * Math.sqrt(variance(p.swap) / p.swap.length + variance(p.plain) / p.plain.length)) : 100,
      minute: quantile(p.minute, 0.5),
      held: quantile(p.held, 0.5),
    })),
  };
}

/** Os 89 pares são testados juntos: o intervalo do veredito é 1,5x o de 95% (~99,7%). */
const VERDICT_WIDTH = 1.5;
/** Trocas mínimas nas partidas para a teoria ter evidência de que é feita. */
export const MIN_SWAP_SAMPLE = 30;

/** Evidência de uma teoria "late-swap": a da compra mais frequente entre as que ela cita. */
export function swapEvidence(stats: SalesStats, theory: Theory): NonNullable<Theory["evidence"]> {
  const own = stats.swaps.filter((s) => s.heroId === theory.heroId && s.sold === theory.items[0] && theory.items.slice(1).includes(s.bought));
  const best = own.sort((a, b) => b.swaps - a.swaps)[0];
  if (!best || best.swaps < MIN_SWAP_SAMPLE) return { verdict: "unclear", lift: best?.lift ?? 0, matches: best?.swaps ?? 0 };
  const verdict = best.lift - best.margin * VERDICT_WIDTH > 0 ? "supported" : best.lift + best.margin * VERDICT_WIDTH < 0 ? "contradicted" : "unclear";
  return { verdict, lift: best.lift, matches: best.swaps };
}
