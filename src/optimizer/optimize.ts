/**
 * Otimizador de build: escolhe itens e upgrades de habilidade para um
 * objetivo e um orçamento de souls, e devolve a ordem de compra.
 *
 * Método: escolha gulosa pelo maior ganho por soul, avaliando sempre a build
 * inteira (assim sinergias e degraus de investimento entram na conta), seguida
 * de busca local por trocas. Não garante o ótimo global.
 */
import type { GameData, Item } from "../data/types.ts";
import { type BuildResult, abilityPointsSpent, componentTree, equippedItems, evaluateBuild, findHero, findItem, owns, progressionFromSouls, ABILITY_UPGRADE_COST, BASE_ITEM_SLOTS, MAX_ACTIVE_ITEMS } from "../engine/index.ts";
import { MID_GAME_MINUTE, VITALITY_SPIKE_SOULS } from "../engine/rules.ts";
import { heroMeta, midGameSouls, minuteForSouls, popularAtSouls, tierGates } from "../meta/stats.ts";
import { compareInWindow, priorFactor, tierPrior, type TierPrior } from "../meta/windows.ts";
import { blendPriors, wpaPrior } from "../meta/wpa.ts";
import { SELL_REFUND } from "../engine/rules.ts";
import { computeMetrics, DEFAULT_METRIC_OPTIONS, OBJECTIVES, score, type MetricOptions, type Metrics, type Objective, type Weights } from "./metrics.ts";
import type { PlanId, ScenarioId } from "../combat/value.ts";
import { analyzePurchase, type Recommendation } from "../combat/explain.ts";
import { effectsFromSource, itemSource } from "../combat/effects.ts";
import { applyReviews } from "../combat/mechanics.ts";
import { discoverInteractions } from "../combat/interactions.ts";

/** Largura do feixe da busca em pares (compras que só passam à frente completando uma interação). */
const COMBO_BEAM = 4;
/** O par precisa render pelo menos isto a mais por soul que a melhor compra sozinha. */
const COMBO_MARGIN = 1.05;
/** Compras com ganho por soul a menos de 3% uma da outra são desempatadas pelas partidas. */
const TIE_MARGIN = 0.03;

export interface OptimizeInput {
  hero: string;
  souls: number;
  /** Objetivo pronto ou pesos próprios por métrica. */
  objective: Objective | Weights;
  itemSlots?: number;
  /** Maior tier de item considerado (padrão 4; o preço do tier 5 na API não é confiável). */
  maxTier?: number;
  /** Itens que precisam estar na build. */
  required?: string[];
  /** Itens proibidos. */
  banned?: string[];
  metric?: Partial<MetricOptions>;
  /**
   * Pico de vitality: a build precisa ter `souls` investidos em vitality antes
   * de gastar `deadline` souls no total. Padrão: 4.800 até os souls médios do
   * herói no começo do mid game. `false` desliga.
   */
  vitalitySpike?: { souls: number; deadline: number } | false;
  /** Só avalia os itens obrigatórios, sem buscar outros (para medir uma build pronta). */
  fixedItems?: boolean;
  /**
   * "progressive" (padrão): monta a build compra a compra, como na partida. Cada
   * compra é a de maior ganho por soul entre as que o herói já consegue pagar
   * naquele ponto, respeitando quando cada tier costuma aparecer nas partidas
   * reais; upgrades aproveitam o componente e, com os slots cheios, o item que
   * menos rende é vendido. "final": escolhe a melhor build para os souls finais
   * e só depois ordena as compras.
   */
  mode?: "progressive" | "final";
  /**
   * Plano das jogadas simuladas (métrica `play`). Padrão: "control" quando o
   * objetivo pesa `play`.
   */
  plan?: PlanId;
  /** Tipos de luta esperados (padrão: mistura do plano, marcada como cenário assumido). */
  fights?: ScenarioId[];
  /** Explica cada compra (jogada, mecanismo, condição, alternativa, incerteza). Custa mais tempo. */
  explain?: boolean;
  /**
   * Peso das partidas na escolha: o ganho por soul de cada compra é multiplicado por
   * exp(peso × Δ/10), onde Δ é quanto o item vence a mais que os outros do mesmo tier
   * comprados na mesma janela (encolhido pela incerteza). 0 desliga.
   */
  matchWeight?: number;
  /**
   * De onde vem o Δ do peso das partidas: "window" = winrate na janela de compra
   * (windows.json); "wpa" = vitória acima do esperado pelo placar de patrimônio na
   * hora da compra (wpa.json), que tira o viés de quem compra já estar ganhando.
   * "blend" = as duas pesadas pela precisão (src/meta/wpa.ts, blendPriors). Padrão:
   * DEFAULT_MATCH_SOURCE quando o snapshot tem wpa.json; sem ele, "window".
   */
  matchSource?: "window" | "wpa" | "blend";
}

/** Peso padrão das partidas na escolha das compras (ver `matchWeight`). */
export const DEFAULT_MATCH_WEIGHT = 1;

/** Fonte padrão do peso das partidas quando o snapshot tem wpa.json (ver `matchSource`). */
export const DEFAULT_MATCH_SOURCE: "window" | "wpa" | "blend" = "blend";

export interface VitalitySpike {
  /** Souls em vitality que formam o pico. */
  target: number;
  /** Gasto total até o qual o pico precisa acontecer. */
  deadline: number;
  /** Minuto em que o herói costuma ter `deadline` souls. */
  deadlineMinute: number;
  /** False quando os souls da build não chegam ao prazo: a regra só é informativa. */
  enforced: boolean;
  /** Souls em vitality na build final. */
  invested: number;
  /** Gasto total no passo da ordem de compra em que o pico acontece (null se não acontece). */
  reachedAt: number | null;
  reachedMinute: number | null;
  /** O pico acontece dentro do prazo (ou a regra não se aplica). */
  ok: boolean;
}

export interface PurchaseStep {
  item: Item;
  /** Souls pagos neste passo (já descontado o componente, se houver). */
  cost: number;
  /** Souls gastos acumulados depois do passo. */
  spent: number;
  /** Pontuação da build depois do passo. */
  score: number;
  /** Quanto esta compra soma à pontuação, comparada no mesmo nível do herói. */
  gain: number;
  /** True quando o item vira componente de um upgrade comprado depois. */
  isComponent: boolean;
  /** Souls ganhos na partida no momento da compra. */
  earned: number;
  /** Minuto médio em que o herói tem esses souls. */
  minute: number;
  /** Item vendido para abrir slot nesta compra. */
  sold: Item | null;
  /** Componente que este item melhora, se já estava equipado. */
  upgradeFrom: Item | null;
  /** True quando o item é vendido numa compra posterior. */
  soldLater: boolean;
  /** Troca que segue uma teoria da comunidade (builds publicadas que vendem X para comprar Y). */
  community?: { title: string; builds: number };
  /** Segunda melhor compra viável no mesmo momento (ganho por soul). */
  alternative?: { item: Item; perSoul: number };
  /** Compra escolhida porque abre uma interação com a próxima (busca em pares). */
  opensCombo?: string[];
  /**
   * Desempate pelas partidas: esta compra passou à frente de `over` (ganho por soul a menos
   * de 3%) porque vence `diff` pp mais quando comprada na mesma janela (± `margin`, 95%).
   */
  tieBreak?: { over: Item; diff: number; margin: number; window: string };
  /** Peso das partidas nesta compra: Δ contra o mesmo tier na janela e o multiplicador aplicado. */
  matchPrior?: TierPrior & { factor: number };
  /** Por que comprar isto agora (com `explain`). */
  why?: Recommendation;
}

export interface OptimizeResult {
  hero: string;
  souls: number;
  weights: Weights;
  items: Item[];
  abilityTiers: number[];
  metrics: Metrics;
  /** Build final avaliada pelo motor (stats, habilidades resolvidas). */
  build: BuildResult;
  baseline: Metrics;
  score: number;
  spent: number;
  order: PurchaseStep[];
  vitality: VitalitySpike | null;
  /** Avaliações de build feitas (custo da busca). */
  evaluations: number;
}

const MAX_SWAP_PASSES = 3;
/** Quantos souls além do preço o herói junta esperando um tier liberar antes de comprar outra coisa. */
const MAX_WAIT_SOULS = 2500;
/** Trocas de fim de jogo (vender um item para comprar outro) avaliadas no fim da montagem. */
const MAX_LATE_SWAPS = 6;
/** Ganho mínimo de pontuação para uma troca valer a venda (abaixo disso é ruído). */
const MIN_SWAP_GAIN = 0.02;
/** Desconto no custo de itens da build-alvo (puxa a montagem para ela). */
const TARGET_PULL = 0.7;
/** Bônus de uma troca que a comunidade faz, por build que a sustenta (fração da pontuação atual). */
const COMMUNITY_SWAP_BONUS = 0.01;
/** Máximo de builds contadas no bônus de uma troca da comunidade. */
const COMMUNITY_MAX_BUILDS = 4;

/**
 * Avaliações já feitas (build pelo motor + métricas), por contexto, souls, upgrades e
 * itens. O resultado de uma avaliação só depende disso, então chamadas que medem a
 * mesma build (a busca do alvo "final" dentro da progressiva, as builds publicadas da
 * comparação) podem dividir o mesmo mapa. Os objetos guardados não são alterados.
 */
export type EvaluationMemo = Map<string, { build: BuildResult; metrics: Metrics }>;

export function optimize(data: GameData, input: OptimizeInput, memo: EvaluationMemo = new Map()): OptimizeResult {
  const hero = findHero(data, input.hero);
  let weights: Weights = typeof input.objective === "string" ? OBJECTIVES[input.objective] : input.objective;
  const slots = input.itemSlots ?? BASE_ITEM_SLOTS;
  const plan: PlanId | undefined = input.plan ?? (weights.play ? "control" : undefined);
  const options: MetricOptions = { ...DEFAULT_METRIC_OPTIONS, ...input.metric, ...(plan ? { plan } : {}), ...(input.fights?.length ? { fights: input.fights } : {}) };
  const banned = new Set((input.banned ?? []).map((n) => findItem(data, n).className));
  const required = (input.required ?? []).map((n) => findItem(data, n));
  const requiredClasses = new Set(required.map((i) => i.className));
  // Fora do conjunto: proibidos, tier acima do limite e upgrades que absorveriam um item obrigatório.
  const pool = data.items.filter(
    (i) => i.tier <= (input.maxTier ?? 4) && !banned.has(i.className) && ![...componentTree(data, i)].some((c) => requiredClasses.has(c)),
  );
  const byClass = new Map(data.items.map((i) => [i.className, i]));
  let evaluations = 0;

  const context = JSON.stringify([hero.name, slots, options]);
  const run = (items: Item[], tiers: number[], souls = input.souls) => {
    evaluations++;
    const classNames = items.map((i) => i.className);
    const key = `${context}|${souls}|${tiers.join(",")}|${classNames.join(",")}`;
    let hit = memo.get(key);
    if (!hit) {
      const build = evaluateBuild(data, { hero: hero.name, souls, items: classNames, abilityTiers: tiers, itemSlots: slots, uptime: options.uptime });
      memo.set(key, (hit = { build, metrics: computeMetrics(build, options) }));
    }
    return hit;
  };

  const runAt = run;

  // --- Upgrades de habilidade: guloso por ganho por ponto ---
  const allocate = (items: Item[], base: Metrics | null, souls = input.souls): number[] => {
    const progression = progressionFromSouls(data.shared, souls);
    const run = (list: Item[], tiers: number[]) => runAt(list, tiers, souls);
    const tiers = [0, 0, 0, 0];
    let current = run(items, tiers).metrics;
    const reference = base ?? current;
    for (;;) {
      const left = progression.abilityPoints - abilityPointsSpent(tiers);
      let best: { slot: number; perPoint: number; metrics: Metrics } | null = null;
      for (let slot = 0; slot < Math.min(4, progression.abilityUnlocks); slot++) {
        const tier = tiers[slot]!;
        const cost = ABILITY_UPGRADE_COST[tier];
        if (cost === undefined || cost > left) continue;
        const next = [...tiers];
        next[slot] = tier + 1;
        const metrics = run(items, next).metrics;
        const perPoint = (score(metrics, reference, weights) - score(current, reference, weights)) / cost;
        if (!best || perPoint > best.perPoint) best = { slot, perPoint, metrics };
      }
      // Pontos sobrando ainda são gastos: upgrade sem ganho medido não piora a build.
      if (!best) break;
      tiers[best.slot]! += 1;
      current = best.metrics;
    }
    return tiers;
  };

  const baseTiers = allocate([], null);
  const baseline = run([], baseTiers).metrics;

  // "Defesa ok": a vida efetiva que as builds publicadas mais jogadas do herói têm
  // com os mesmos souls, com 10% de folga. Sem estatísticas, fica o piso padrão do objetivo.
  const popular = heroMeta(data, hero.id)?.builds ?? [];
  /** Piso de defesa (múltiplo da vida sem itens) das builds publicadas cortadas em `souls`; null sem builds. */
  const popularFloor = (souls: number, tiers: number[], reference: Metrics, minItems: number): number | null => {
    const ratios = popular
      .map((b) => popularAtSouls(data, b, souls, slots))
      .filter((items) => items.length >= minItems)
      .map((items) => run(items, tiers, souls).metrics.ehp / Math.max(reference.ehp, 1))
      .sort((a, b) => a - b);
    if (ratios.length === 0) return null;
    return ratios[Math.floor(ratios.length / 2)]! * 0.9;
  };
  if (weights.ehpFloor !== undefined && !input.fixedItems) {
    const floor = popularFloor(input.souls, baseTiers, baseline, 3);
    if (floor !== null) weights = { ...weights, ehpFloor: Math.max(1.1, floor) };
  }
  const scoreOf = (items: Item[], tiers: number[]) => score(run(items, tiers).metrics, baseline, weights);

  // --- Restrições ---
  /** Remove componentes absorvidos por um upgrade presente (em qualquer nível) e itens repetidos. */
  const equipped = (items: Item[]) => equippedItems(data, items);
  const cost = (items: Item[]) => equipped(items).reduce((sum, i) => sum + i.cost, 0);
  const valid = (items: Item[]) => {
    const eq = equipped(items);
    return eq.length <= slots && eq.filter((i) => i.isActive).length <= MAX_ACTIVE_ITEMS && cost(items) <= input.souls;
  };
  const vitalityOf = (items: Item[]) => equipped(items).reduce((sum, i) => sum + (i.slot === "vitality" ? i.cost : 0), 0);
  const spike = input.vitalitySpike === false ? null : (input.vitalitySpike ?? { souls: VITALITY_SPIKE_SOULS, deadline: midGameSouls(data, hero.id) });
  // A regra vale quando a build passa do prazo; antes dele, a build ainda pode chegar lá depois.
  const enforce = spike !== null && input.souls >= spike.deadline;
  /** Uma mudança não pode desfazer o pico já alcançado. */
  const keepsSpike = (before: Item[], after: Item[]) => !enforce || vitalityOf(after) >= Math.min(spike!.souls, vitalityOf(before));

  // --- Itens: guloso por ganho por soul ---
  let chosen: Item[] = [...required];
  let current = scoreOf(chosen, baseTiers);
  /** O item já está no inventário, sozinho ou dentro de um upgrade: o jogo não deixa ter dois iguais. */
  const has = (list: Item[], item: Item) => owns(data, list, item);
  const progressive = !input.fixedItems && (input.mode ?? "progressive") === "progressive";
  let progressiveOrder: PurchaseStep[] | null = null;
  let progressiveReached: number | null = null;

  if (progressive) {
    const gates = tierGates(data, hero.id);
    // Alvo: a melhor build para os souls finais. O jogador compra pensando nela; item
    // fora do alvo vai ser vendido pela metade depois, então custa 50% a mais na conta.
    const target = optimize(data, { ...input, mode: "final" }, memo);
    const targetClasses = new Set(target.items.flatMap((i) => [i.className, ...componentTree(data, i)]));
    const pull = TARGET_PULL;
    // Tier 4 é o fim da cadeia de upgrades: não é comprado para ser vendido, então não paga a revenda.
    const effectivePay = (item: Item, pay: number) =>
      targetClasses.has(item.className) ? pay * pull : pay + (item.tier >= (input.maxTier ?? 4) ? 0 : item.cost * (1 - SELL_REFUND));
    // Upgrades de habilidade dependem dos pontos disponíveis; um plano por quantidade de pontos.
    const tiersCache = new Map<number, number[]>();
    const tiersAt = (souls: number) => {
      const points = progressionFromSouls(data.shared, souls).abilityPoints;
      let tiers = tiersCache.get(points);
      if (!tiers) tiersCache.set(points, (tiers = allocate([], null, souls)));
      return tiers;
    };
    // Referência do mesmo nível para o piso de defesa: o herói sem itens naquele momento.
    const levelBaseline = new Map<number, Metrics>();
    const baselineAt = (souls: number) => {
      const level = progressionFromSouls(data.shared, souls).level;
      let ref = levelBaseline.get(level);
      if (!ref) levelBaseline.set(level, (ref = run([], tiersAt(souls), souls).metrics));
      return ref;
    };
    // O piso de defesa acompanha a partida: em cada compra, é o das builds publicadas
    // com os mesmos souls (não o dos souls finais, que no começo nenhuma compra alcança).
    const floorCache = new Map<number, Weights>();
    const weightsAt = (souls: number): Weights => {
      if (weights.ehpFloor === undefined || input.fixedItems) return weights;
      const bucket = Math.round(souls / 800) * 800;
      let w = floorCache.get(bucket);
      if (!w) {
        const at = Math.max(bucket, 800);
        const floor = popular.length ? popularFloor(at, tiersAt(at), baselineAt(at), 1) : weights.ehpFloor;
        floorCache.set(bucket, (w = { ...weights, ehpFloor: Math.max(1.05, floor ?? 1.05) }));
      }
      return w;
    };
    const scoreAt = (items: Item[], souls: number) => {
      const w = weightsAt(souls);
      return score(run(items, tiersAt(souls), souls).metrics, baseline, w, w.ehpFloor ? baselineAt(souls) : baseline);
    };

    // Trocas de fim de jogo da comunidade (teorias "late-swap": vender items[0], comprar items[1..]).
    const communitySwaps = (data.theories ?? []).filter((th) => th.heroId === hero.id && th.kind === "late-swap" && th.items.length >= 2);
    const swapTheory = (sold: Item, bought: Item) =>
      communitySwaps.find((th) => th.items[0] === sold.className && th.items.slice(1).includes(bought.className)) ?? null;
    const sellTheory = (item: Item) => communitySwaps.find((th) => th.items[0] === item.className) ?? null;
    const communityBonus = (builds: number) => COMMUNITY_SWAP_BONUS * Math.min(COMMUNITY_MAX_BUILDS, builds);

    let owned: Item[] = [];
    const soldOnce = new Set<string>(); // item vendido não volta: recomprar só desperdiça souls
    let earned = 0; // souls ganhos até a última compra (o que foi gasto, já descontadas as vendas)
    type Step = {
      item: Item;
      pay: number;
      earned: number;
      score: number;
      gain: number;
      sold: Item | null;
      upgradeFrom: Item | null;
      community?: { title: string; builds: number };
      before: Item[];
      after: Item[];
      alternative?: { item: Item; perSoul: number; after: Item[] };
      opensCombo?: string[];
      tieBreak?: PurchaseStep["tieBreak"];
      scoreMargin?: number;
      matchPrior?: PurchaseStep["matchPrior"];
    };
    // Peso das partidas: Δ do item contra o mesmo tier na janela de compra.
    const matchWeight = input.fixedItems ? 0 : (input.matchWeight ?? DEFAULT_MATCH_WEIGHT);
    const minuteCache = new Map<number, number>();
    const minuteAt = (souls: number) => {
      const key = Math.round(souls / 100);
      let m = minuteCache.get(key);
      if (m === undefined) minuteCache.set(key, (m = minuteForSouls(data, hero.id, souls)));
      return m;
    };
    const priorCache = new Map<string, TierPrior | null>();
    const source = data.wpa ? (input.matchSource ?? DEFAULT_MATCH_SOURCE) : "window";
    // O WPA já condiciona no estado da partida, então não depende do minuto.
    const wpaCache = new Map<string, TierPrior | null>();
    const wpaOf = (item: Item) => {
      if (!wpaCache.has(item.className)) wpaCache.set(item.className, wpaPrior(data, hero.id, item));
      return wpaCache.get(item.className)!;
    };
    const priorOf = (item: Item, souls: number) => {
      if (matchWeight <= 0) return null;
      const minute = minuteAt(souls);
      const key = `${item.className}|${minute}`;
      if (!priorCache.has(key)) {
        const window = source === "wpa" ? null : tierPrior(data, hero.id, item, minute);
        // Sem dados da fonte pedida, cai para a outra.
        const prior = source === "window" ? window : source === "wpa" ? (wpaOf(item) ?? tierPrior(data, hero.id, item, minute)) : blendPriors(window, wpaOf(item));
        priorCache.set(key, prior);
      }
      return priorCache.get(key)!;
    };
    const factorOf = (item: Item, souls: number) => priorFactor(priorOf(item, souls), matchWeight);
    // Itens com efeito que forma uma família de interação com o kit (candidatos da busca em pares).
    const patch = data.meta.clientVersion;
    const kitEffects = data.abilities
      .filter((a) => a.heroId === hero.id)
      .flatMap((a) => applyReviews(effectsFromSource({ kind: "ability", className: a.className, name: a.name, slot: a.slot, text: a.text, isActive: true, props: a.properties }, patch), a.className));
    const mechanismItems = new Set(
      pool
        .filter((i) => i.isActive)
        .filter((i) => {
          const own = applyReviews(effectsFromSource(itemSource(i), patch), i.className);
          return own.length > 0 && discoverInteractions([...kitEffects, ...own]).some((c) => c.setup?.source.className === i.className || c.payoff.source.className === i.className);
        })
        .map((i) => i.className),
    );
    const itemEffects = (i: Item) => applyReviews(effectsFromSource(itemSource(i), patch), i.className);
    const pairCache = new Map<string, boolean>();
    /** Efeitos dos dois itens formam uma família de interação entre si. */
    const pairInteracts = (a: Item, b: Item) => {
      const key = `${a.className}|${b.className}`;
      if (!pairCache.has(key)) {
        const found = discoverInteractions([...itemEffects(a), ...itemEffects(b)]).some((c) => {
          const s = c.setup?.source.className;
          const p = c.payoff.source.className;
          return (s === a.className && p === b.className) || (s === b.className && p === a.className);
        });
        pairCache.set(key, found);
      }
      return pairCache.get(key)!;
    };
    const steps: Step[] = [];
    const communityOf = (sold: Item | null, bought: Item) => {
      const th = sold ? swapTheory(sold, bought) : null;
      return th ? { title: th.title, builds: th.builds.length } : undefined;
    };
    for (;;) {
      const missing = spike ? spike.souls - vitalityOf(owned) : 0;
      // Item que menos rende hoje: é o vendido quando os slots enchem.
      // Não vende obrigatórios nem o que desfaria o pico de vitality já alcançado.
      const sellable = owned.filter((i) => !requiredClasses.has(i.className) && keepsSpike(owned, owned.filter((o) => o !== i)));
      const nowScore = scoreAt(owned, Math.max(earned, 1));
      let victim: Item | null = null;
      if (equipped(owned).length >= slots && sellable.length > 0) {
        let least = Infinity;
        for (const item of sellable) {
          // Item que a comunidade manda vender perde menos ao sair.
          const hint = sellTheory(item);
          const loss = nowScore - scoreAt(owned.filter((i) => i !== item), Math.max(earned, 1)) - (hint ? nowScore * communityBonus(hint.builds.length) : 0);
          if (loss < least) [least, victim] = [loss, item];
        }
      }

      type Option = { item: Item; next: Item[]; pay: number; at: number; sold: Item | null; required: boolean };
      const options2: Option[] = [];
      for (const candidate of pool) {
        if (has(owned, candidate) || soldOnce.has(candidate.className)) continue;
        let next = equipped([...owned, candidate]);
        let sold: Item | null = null;
        if (next.length > slots) {
          if (!victim || componentTree(data, candidate).has(victim.className)) continue;
          sold = victim;
          next = equipped([...owned.filter((i) => i !== victim), candidate]);
        }
        if (next.filter((i) => i.isActive).length > MAX_ACTIVE_ITEMS) continue;
        const pay = cost(next) - cost(owned) + (sold ? sold.cost - Math.round(sold.cost * SELL_REFUND) : 0);
        if (pay <= 0) continue;
        // A compra acontece quando o herói junta o preço, mas não antes de o tier costumar aparecer.
        const isRequired = requiredClasses.has(candidate.className);
        const at = Math.max(earned + pay, isRequired ? 0 : (gates[candidate.tier] ?? Infinity));
        if (at > input.souls) continue;
        options2.push({ item: candidate, next, pay, at, sold, required: isRequired });
      }
      // Enquanto o pico de vitality não vem, só entra compra fora de vitality que ainda deixe tempo para ele.
      // Vale também para itens de vitality: o que falta depois deles ainda precisa caber no prazo.
      const fits = (o: Option) => !enforce || missing <= 0 || o.at + Math.max(0, spike!.souls - vitalityOf(o.next)) <= spike!.deadline;
      const allowed = options2.some(fits) ? options2.filter(fits) : options2;
      // Item obrigatório entra assim que o tier dele costuma aparecer.
      const mustBuy = allowed.filter((o) => o.required && o.at >= (gates[o.item.tier] ?? 0));
      const pool2 = mustBuy.length ? mustBuy : allowed;

      type Scored = Option & { score: number; perSoul: number; gain: number; before: number };
      const scoreOption = (o: Option): Scored => {
        const before = o.at === earned ? nowScore : scoreAt(owned, o.at);
        const s = scoreAt(o.next, o.at);
        // Ganho pelos souls que passam até a compra: esperar um tier mais caro também custa.
        // Troca que a comunidade faz (vender X para comprar Y) ganha um bônus.
        const th = o.sold ? swapTheory(o.sold, o.item) : null;
        const bonus = th ? before * communityBonus(th.builds.length) : 0;
        const raw = (s - before + bonus) / (o.at - earned - o.pay + effectivePay(o.item, o.pay));
        // As partidas só ajustam compras que o modelo já vê como ganho (não transformam perda em ganho).
        const perSoul = raw > 0 ? raw * factorOf(o.item, o.at) : raw;
        return { ...o, score: s, perSoul, gain: s - before, before };
      };
      let ranked: Scored[] = [];
      const pick = (list: Option[]): Scored | null => {
        let best: Scored | null = null;
        ranked = [];
        for (const o of list) {
          const x = scoreOption(o);
          ranked.push(x);
          // Vitality que fecha o pico entra mesmo sem ganho medido no objetivo (ex.: objetivo de arma).
          const forcedVitality = enforce && missing > 0 && o.item.slot === "vitality";
          if ((o.required || forcedVitality || x.perSoul > 1e-9) && (!best || (o.required && !best.required) || x.perSoul > best.perSoul)) best = x;
        }
        ranked.sort((a, b) => b.perSoul - a.perSoul);
        return best;
      };
      // Jogador junta souls para um tier mais alto por pouco tempo, não por 10 mil souls
      // de mãos vazias: espera longa só vale quando nada liberado ajuda. (Comparar com
      // uma compra muito à frente engana: lá o piso de defesa já subiu e qualquer item
      // de vida parece ótimo.)
      let best = pick(pool2.filter((o) => o.at - (earned + o.pay) <= MAX_WAIT_SOULS)) ?? pick(pool2);
      if (!best) break;
      // Busca em pares: uma compra que sozinha rende pouco pode passar à frente quando
      // completa uma interação com a seguinte (candidatos pelas mecânicas e pelo ranking).
      let opensCombo: string[] | undefined;
      if (plan && !best.required) {
        const byMechanism = ranked.filter((o) => mechanismItems.has(o.item.className)).slice(0, COMBO_BEAM);
        const firsts = [...new Map([...ranked.slice(0, COMBO_BEAM), ...byMechanism].map((o) => [o.item.className, o])).values()];
        let bestPair: { first: Scored; second: Item; perSoul: number } | null = null;
        for (const a of firsts) {
          for (const b of firsts) {
            if (a === b || has(a.next, b.item) || componentTree(data, a.item).has(b.item.className)) continue;
            // O par precisa de um mecanismo identificável: um melhora o outro ou os efeitos dos dois interagem.
            if (!componentTree(data, b.item).has(a.item.className) && !pairInteracts(a.item, b.item)) continue;
            const nextAB = equipped([...a.next, b.item]);
            if (nextAB.length > slots || nextAB.filter((i) => i.isActive).length > MAX_ACTIVE_ITEMS) continue;
            const payB = cost(nextAB) - cost(a.next);
            if (payB <= 0) continue;
            const atB = Math.max(a.at + payB, gates[b.item.tier] ?? Infinity);
            if (atB > input.souls || atB - (a.at + payB) > MAX_WAIT_SOULS) continue;
            const sAB = scoreAt(nextAB, atB);
            const rawAB = (sAB - a.before) / (atB - earned - a.pay - payB + effectivePay(a.item, a.pay) + effectivePay(b.item, payB));
            const perSoul = rawAB > 0 ? rawAB * Math.sqrt(factorOf(a.item, a.at) * factorOf(b.item, atB)) : rawAB;
            if (!bestPair || perSoul > bestPair.perSoul) bestPair = { first: a, second: b.item, perSoul };
          }
        }
        if (bestPair && bestPair.first.item !== best.item && bestPair.first.perSoul > 0 && bestPair.perSoul > best.perSoul * COMBO_MARGIN) {
          best = bestPair.first;
          opensCombo = [bestPair.second.name];
        }
      }
      let runnerUp = ranked.find((o) => o.item !== best!.item && o.perSoul > 0) ?? null;
      // Desempate pelas partidas: com ganho por soul quase igual, fica a compra que vence mais
      // quando comprada no mesmo momento da partida, se a diferença passa do intervalo de 95%.
      let tieBreak: PurchaseStep["tieBreak"];
      // Só entre itens do mesmo tier: comprar o mais caro na mesma janela já indica vantagem.
      if (!opensCombo && runnerUp && !best.required && best.perSoul > 0 && runnerUp.item.tier === best.item.tier && runnerUp.perSoul >= best.perSoul * (1 - TIE_MARGIN)) {
        const minute = minuteForSouls(data, hero.id, best.at);
        const cmp = compareInWindow(data, hero.id, runnerUp.item, best.item, minute);
        if (cmp?.significant && cmp.diff > 0) {
          tieBreak = { over: best.item, diff: cmp.diff, margin: cmp.margin, window: cmp.a.window };
          [best, runnerUp] = [runnerUp, best];
        }
      }
      const scoreMargin = runnerUp && best.perSoul > 0 ? (best.perSoul - runnerUp.perSoul) / best.perSoul : undefined;
      const upgradeFrom = owned.find((i) => componentTree(data, best!.item).has(i.className)) ?? null;
      // O vendido sai junto com os componentes que ele absorveu: nenhum deles volta.
      if (best.sold) for (const cls of [best.sold.className, ...componentTree(data, best.sold)]) soldOnce.add(cls);
      const ownedBefore = owned;
      const prior = priorOf(best.item, best.at);
      const matchPrior = prior ? { ...prior, factor: priorFactor(prior, matchWeight) } : undefined;
      owned = best.next;
      earned = best.at;
      steps.push({
        ...(matchPrior ? { matchPrior } : {}),
        item: best.item,
        pay: best.pay,
        earned,
        score: best.score,
        gain: best.gain,
        sold: best.sold,
        upgradeFrom,
        community: communityOf(best.sold, best.item),
        before: ownedBefore,
        after: owned,
        ...(runnerUp ? { alternative: { item: runnerUp.item, perSoul: runnerUp.perSoul, after: runnerUp.next } } : {}),
        ...(opensCombo ? { opensCombo } : {}),
        ...(tieBreak ? { tieBreak } : {}),
        ...(scoreMargin !== undefined ? { scoreMargin } : {}),
      });
      if (spike && progressiveReached === null && vitalityOf(owned) >= spike.souls) progressiveReached = earned;
    }

    // Trocas de fim de jogo: com os slots cheios, o recurso escasso é o slot, não o soul.
    // Testa vender qualquer item (não só o que menos rende) para comprar outro, e fica com
    // a troca que mais aumenta a pontuação no slot. É o que tira a build de itens baratos
    // de tier 1-2 (Battle Vest, Enchanter's Emblem) quando sobram souls para tier 3-4.
    for (let pass = 0; pass < MAX_LATE_SWAPS && equipped(owned).length >= slots; pass++) {
      const nowAt = scoreAt(owned, Math.max(earned, 1));
      let best: { item: Item; sold: Item; next: Item[]; pay: number; at: number; score: number; gain: number; value: number } | null = null;
      for (const victim of owned) {
        if (requiredClasses.has(victim.className)) continue;
        const without = owned.filter((i) => i !== victim);
        for (const candidate of pool) {
          if (candidate.tier < victim.tier || has(owned, candidate) || soldOnce.has(candidate.className)) continue;
          if (componentTree(data, candidate).has(victim.className)) continue; // upgrade de componente é compra normal
          const next = equipped([...without, candidate]);
          if (next.length > slots || next.filter((i) => i.isActive).length > MAX_ACTIVE_ITEMS || !keepsSpike(owned, next)) continue;
          const pay = candidate.cost - Math.round(victim.cost * SELL_REFUND);
          const at = Math.max(earned + Math.max(pay, 0), gates[candidate.tier] ?? Infinity);
          if (at > input.souls) continue;
          const before = at === earned ? nowAt : scoreAt(owned, at);
          const s = scoreAt(next, at);
          const th = swapTheory(victim, candidate);
          const value = s - before + (th ? before * communityBonus(th.builds.length) : 0);
          if (value > MIN_SWAP_GAIN && (!best || value > best.value)) best = { item: candidate, sold: victim, next, pay: Math.max(pay, 0), at, score: s, gain: s - before, value };
        }
      }
      if (!best) break;
      for (const cls of [best.sold.className, ...componentTree(data, best.sold)]) soldOnce.add(cls);
      const ownedBefore = owned;
      owned = best.next;
      earned = best.at;
      steps.push({ item: best.item, pay: best.pay, earned, score: best.score, gain: best.gain, sold: best.sold, upgradeFrom: null, community: communityOf(best.sold, best.item), before: ownedBefore, after: owned });
    }

    // Itens obrigatórios que nunca ficaram baratos o bastante: entram no fim, se couberem.
    for (const item of required) {
      if (has(owned, item)) continue;
      const next = equipped([...owned, item]);
      const pay = cost(next) - cost(owned);
      if (next.length > slots || earned + pay > input.souls) continue;
      const ownedBefore = owned;
      owned = next;
      earned += pay;
      const before = scoreAt(owned.filter((i) => i !== item), earned);
      const after = scoreAt(owned, earned);
      steps.push({ item, pay, earned, score: after, gain: after - before, sold: null, upgradeFrom: null, before: ownedBefore, after: owned });
    }

    chosen = owned;
    const consumed = new Set(owned.flatMap((i) => [...componentTree(data, i)]));
    progressiveOrder = steps.map((s, i) => ({
      item: s.item,
      cost: s.pay,
      spent: s.earned,
      score: s.score,
      gain: s.gain,
      isComponent: steps.slice(i + 1).some((later) => later.upgradeFrom === s.item) || consumed.has(s.item.className),
      earned: s.earned,
      minute: minuteForSouls(data, hero.id, s.earned),
      sold: s.sold,
      upgradeFrom: s.upgradeFrom,
      soldLater: steps.slice(i + 1).some((later) => later.sold === s.item),
      ...(s.community ? { community: s.community } : {}),
      ...(s.alternative ? { alternative: { item: s.alternative.item, perSoul: s.alternative.perSoul } } : {}),
      ...(s.opensCombo ? { opensCombo: s.opensCombo } : {}),
      ...(s.tieBreak ? { tieBreak: s.tieBreak } : {}),
      ...(s.matchPrior ? { matchPrior: s.matchPrior } : {}),
      // Por que comprar agora: ΔU das jogadas no momento da compra, contra a alternativa.
      ...(input.explain
        ? {
            why: analyzePurchase(
              data,
              { hero: hero.name, souls: Math.max(s.earned, 1), abilityTiers: tiersAt(Math.max(s.earned, 1)), itemSlots: slots, uptime: options.uptime, plan: plan ?? "damage", ...(input.fights?.length ? { fights: input.fights } : {}), ...(s.scoreMargin !== undefined ? { scoreMargin: s.scoreMargin } : {}) },
              s.before.map((x) => x.className),
              s.after.map((x) => x.className),
              s.item,
              s.alternative ? { item: s.alternative.item, after: s.alternative.after.map((x) => x.className) } : null,
            ),
          }
        : {}),
    }));
  }

  const greedy = () => {
    for (;;) {
      let best: { items: Item[]; score: number; perSoul: number } | null = null;
      const spent = cost(chosen);
      for (const candidate of pool) {
        // Não compra item repetido nem componente de algo que já está na build.
        if (has(chosen, candidate)) continue;
        const next = equipped([...chosen, candidate]);
        if (!valid(next) || !keepsSpike(chosen, next)) continue;
        const delta = cost(next) - spent;
        if (delta <= 0) continue;
        const s = scoreOf(next, baseTiers);
        const perSoul = (s - current) / delta;
        if (perSoul > 1e-9 && (!best || perSoul > best.perSoul)) best = { items: next, score: s, perSoul };
      }
      if (!best) return;
      chosen = best.items;
      current = best.score;
    }
  };
  if (!input.fixedItems && !progressive) greedy();

  // --- Pico de vitality: troca ou acrescenta itens de vitality até chegar ao alvo ---
  // Entre as mudanças que aumentam o investimento em vitality, fica a de maior pontuação.
  const repair = () => {
    while (enforce && vitalityOf(chosen) < spike!.souls) {
      const before = vitalityOf(chosen);
      let best: { items: Item[]; score: number } | null = null;
      for (const candidate of pool) {
        if (candidate.slot !== "vitality" || has(chosen, candidate)) continue;
        const outs: (Item | null)[] = [null, ...chosen.filter((i) => i.slot !== "vitality" && !requiredClasses.has(i.className))];
        for (const out of outs) {
          const next = equipped([...chosen.filter((i) => i !== out), candidate]);
          if (!valid(next) || vitalityOf(next) <= before) continue;
          const s = scoreOf(next, baseTiers);
          if (!best || s > best.score) best = { items: next, score: s };
        }
      }
      if (!best) return; // sem como chegar ao alvo (orçamento ou itens obrigatórios)
      chosen = best.items;
      current = best.score;
    }
  };
  if (!input.fixedItems && !progressive) {
    repair();
    greedy();
  }

  // --- Busca local: troca um item por outro se a pontuação melhorar ---
  for (let pass = 0; pass < (input.fixedItems || progressive ? 0 : MAX_SWAP_PASSES); pass++) {
    let best: { items: Item[]; score: number } | null = null;
    for (const out of chosen) {
      if (requiredClasses.has(out.className)) continue;
      const without = chosen.filter((i) => i.className !== out.className);
      for (const candidate of pool) {
        if (has(chosen, candidate) || has(without, candidate)) continue;
        const next = equipped([...without, candidate]);
        if (!valid(next) || !keepsSpike(chosen, next)) continue;
        const s = scoreOf(next, baseTiers);
        if (s > current + 1e-6 && (!best || s > best.score)) best = { items: next, score: s };
      }
    }
    if (!best) break;
    chosen = best.items;
    current = best.score;
    greedy(); // a troca pode ter liberado souls
  }

  const abilityTiers = allocate(chosen, baseline);
  const final = run(chosen, abilityTiers);

  // --- Ordem de compra: a cada passo, o maior ganho por soul entre o que falta ---
  const order: PurchaseStep[] = progressiveOrder ?? [];
  let owned: Item[] = [];
  let spent = 0;
  const remaining = new Set(progressiveOrder ? [] : chosen.map((i) => i.className));
  // A ordem é avaliada no nível final, com os upgrades finais: mostra quanto cada compra aproxima da build pronta.
  const stepScore = (items: Item[], _spent: number) => score(run(items, abilityTiers).metrics, baseline, weights);
  let reachedAt: number | null = progressiveReached;
  while (remaining.size > 0) {
    let best: { item: Item; pay: number; next: Item[]; score: number; perSoul: number; isComponent: boolean } | null = null;
    const now = stepScore(owned, spent);
    const options2: { item: Item; isComponent: boolean }[] = [];
    for (const cls of remaining) {
      const item = byClass.get(cls)!;
      options2.push({ item, isComponent: false });
      for (const c of componentTree(data, item)) {
        const comp = byClass.get(c);
        if (comp && !has(owned, comp)) options2.push({ item: comp, isComponent: true });
      }
    }
    // Enquanto o pico de vitality não vem, uma compra fora de vitality só entra se ainda sobrar
    // espaço até o prazo para completar o pico depois dela.
    const missing = spike ? spike.souls - vitalityOf(owned) : 0;
    const fits = (opt: { item: Item }, pay: number) => !enforce || missing <= 0 || opt.item.slot === "vitality" || spent + pay + missing <= spike!.deadline;
    const anyFits = options2.some((opt) => {
      const pay = cost(equipped([...owned, opt.item])) - cost(owned);
      return pay > 0 && fits(opt, pay);
    });
    for (const opt of options2) {
      const next = equipped([...owned, opt.item]);
      const pay = cost(next) - cost(owned);
      if (pay <= 0) continue;
      if (anyFits && !fits(opt, pay)) continue;
      const s = stepScore(next, spent + pay);
      const perSoul = (s - now) / pay;
      if (!best || perSoul > best.perSoul) best = { item: opt.item, pay, next, score: s, perSoul, isComponent: opt.isComponent };
    }
    if (!best) break;
    owned = best.next;
    spent += best.pay;
    if (!best.isComponent) remaining.delete(best.item.className);
    if (spike && reachedAt === null && vitalityOf(owned) >= spike.souls) reachedAt = spent;
    order.push({
      item: best.item,
      cost: best.pay,
      spent,
      score: best.score,
      gain: best.score - now,
      isComponent: best.isComponent,
      earned: spent,
      minute: minuteForSouls(data, hero.id, spent),
      sold: null,
      upgradeFrom: null,
      soldLater: false,
    });
  }

  return {
    hero: hero.name,
    souls: input.souls,
    weights,
    items: equipped(chosen),
    abilityTiers,
    metrics: final.metrics,
    build: final.build,
    baseline,
    score: score(final.metrics, baseline, weights),
    spent: progressiveOrder ? (progressiveOrder.at(-1)?.earned ?? 0) : cost(chosen),
    order,
    vitality: spike
      ? {
          target: spike.souls,
          deadline: spike.deadline,
          deadlineMinute: input.vitalitySpike ? minuteForSouls(data, hero.id, spike.deadline) : MID_GAME_MINUTE,
          enforced: enforce,
          invested: vitalityOf(chosen),
          reachedAt,
          reachedMinute: reachedAt === null ? null : minuteForSouls(data, hero.id, reachedAt),
          ok: !enforce || (reachedAt !== null && reachedAt <= spike.deadline),
        }
      : null,
    evaluations,
  };
}
