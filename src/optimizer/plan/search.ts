/**
 * Busca em feixe sobre rotas completas.
 *
 * Começa de várias rotas prontas (a gulosa e as planejadas para os marcos da partida),
 * e a cada rodada mexe nas melhores: troca a ordem de compras, troca, tira ou põe um
 * item, muda o vendido. Fica com as melhores rotas diferentes por J. A sequência de
 * mudanças é sorteada com semente fixa: a mesma entrada dá sempre a mesma build.
 */
import type { Item } from "../../data/types.ts";
import { componentTree } from "../../engine/inventory.ts";
import { simulate, type Intent, type PlanContext, type Route } from "./simulate.ts";

export interface SearchOptions {
  /** Rotas mantidas por rodada. */
  width: number;
  /** Mudanças tentadas por rota e rodada. */
  moves: number;
  /** Avaliações de build que a busca pode gastar. */
  budget: number;
  seed: number;
  /** Avaliações novas feitas até agora (contador de quem chama). */
  spent: () => number;
}

/** Rodadas seguidas sem melhora até sacudir o feixe, e sacudidas seguidas sem melhora até parar. */
const MAX_STALE = 3;
const MAX_KICKS = 4;
/** Mudanças de uma sacudida. */
const KICK_MOVES = 4;

/** Gerador pseudoaleatório pequeno (mulberry32). */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const intentsOf = (route: Route): Intent[] => route.steps.map((s) => ({ item: s.item, sold: s.sold }));

/** `candidates`: itens que a busca pode pôr na rota, do mais ao menos promissor. */
export function searchRoute(ctx: PlanContext, starts: Intent[][], candidates: Item[], options: SearchOptions): Route {
  const rnd = random(options.seed);
  const pick = <T,>(list: T[]): T => list[Math.floor(rnd() * list.length)]!;
  // Os mais promissores saem mais vezes.
  const candidate = () => candidates[Math.floor(rnd() ** 2 * candidates.length)]!;
  const start = options.spent();
  const left = () => options.budget - (options.spent() - start);

  const best = (routes: Route[]) => {
    const unique = new Map<string, Route>();
    for (const r of routes) if (!unique.has(r.key)) unique.set(r.key, r);
    return [...unique.values()].sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : 1)).slice(0, options.width);
  };

  let beam = best(starts.map((s) => simulate(ctx, s)));
  const seen = new Set(beam.map((r) => r.key));
  const mutate = (route: Route): Intent[] => {
    const list = intentsOf(route);
    const n = list.length;
    const roll = rnd();
    /** Item da rota que daria lugar a uma compra na posição i. */
    const victim = (i: number) => {
      const owned = i < n ? route.steps[i]!.before : (route.steps.at(-1)?.after ?? []);
      const cheap = owned.filter((x) => !ctx.required.has(x.className));
      return cheap.length ? pick(cheap) : null;
    };
    if (n === 0 || roll < 0.25) {
      const i = Math.floor(rnd() * (n + 1));
      list.splice(i, 0, { item: candidate(), sold: rnd() < 0.5 ? victim(i) : null });
    } else if (roll < 0.55) {
      const i = Math.floor(rnd() * n);
      if (ctx.required.has(list[i]!.item.className)) return list;
      list[i] = { item: candidate(), sold: list[i]!.sold };
    } else if (roll < 0.75) {
      const i = Math.floor(rnd() * n);
      const [moved] = list.splice(i, 1);
      const to = Math.max(0, Math.min(list.length, i + (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 4))));
      list.splice(to, 0, moved!);
    } else if (roll < 0.85) {
      const i = Math.floor(rnd() * n);
      if (!ctx.required.has(list[i]!.item.className)) list.splice(i, 1);
    } else if (roll < 0.95) {
      const i = Math.floor(rnd() * n);
      list[i] = { ...list[i]!, sold: list[i]!.sold && rnd() < 0.5 ? null : victim(i) };
    } else {
      // Planeja o componente de um item da rota antes dele.
      const i = Math.floor(rnd() * n);
      const tree = componentTree(ctx.data, list[i]!.item);
      const parts = candidates.filter((c) => tree.has(c.className));
      if (parts.length) list.splice(Math.floor(rnd() * (i + 1)), 0, { item: pick(parts), sold: null });
    }
    return list;
  };

  // Uma parte do orçamento fica para completar o fim da rota.
  const reserve = options.budget * 0.15;
  let champion = beam[0]!;
  let kicks = 0;
  for (let stale = 0; left() > reserve; ) {
    if (stale >= MAX_STALE) {
      // Feixe parado num ótimo local: recomeça de versões bem mexidas da melhor rota.
      if (beam[0]!.value > champion.value + 1e-6) [champion, kicks] = [beam[0]!, 0];
      if (++kicks > MAX_KICKS) break;
      beam = best(
        Array.from({ length: options.width }, () => {
          let r = champion;
          for (let m = 0; m < KICK_MOVES; m++) r = simulate(ctx, mutate(r));
          return r;
        }),
      );
      stale = 0;
    }
    const top = beam[0]!.value;
    const next: Route[] = [...beam];
    for (const route of beam) {
      for (let m = 0; m < options.moves && left() > reserve; m++) {
        // Às vezes duas mudanças de uma vez: sair de um item e entrar em outro no lugar certo.
        const first = mutate(route);
        const r = simulate(ctx, rnd() < 0.25 ? mutate(simulate(ctx, first)) : first);
        if (seen.has(r.key)) continue;
        seen.add(r.key);
        next.push(r);
      }
    }
    beam = best(next);
    stale = beam[0]!.value > top + 1e-6 ? 0 : stale + 1;
  }

  // Souls que sobram no fim: acrescenta a compra (ou troca) que mais ajuda, enquanto ajudar.
  let route = beam[0]!.value > champion.value ? beam[0]! : champion;
  while (left() > 0) {
    const list = intentsOf(route);
    const owned = route.steps.at(-1)?.after ?? [];
    let found: Route | null = null;
    for (const item of candidates) {
      if (left() <= 0) break;
      for (const sold of [null, ...owned.filter((i) => i.tier <= 2 && i.tier <= item.tier && !ctx.required.has(i.className))]) {
        if (left() <= 0) break;
        const r = simulate(ctx, [...list, { item, sold }]);
        if (r.steps.length > route.steps.length && r.value > (found ?? route).value + 1e-6) found = r;
      }
    }
    if (!found) break;
    route = found;
  }
  return route;
}
