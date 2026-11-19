/**
 * Valor de jogadas: U(estado, contexto).
 *
 * Estado = build avaliada pelo motor (inventário, níveis de habilidade, stats).
 * Contexto = plano de jogo (pesos explícitos), cenários de luta e souls.
 * Para cada cenário, uma busca em feixe monta sequências de até 3 ações com
 * intervalos executáveis (inclusive lançar a habilidade atrasada ANTES da ação
 * que prepara o acerto), simula cada uma e fica com a melhor. O valor por minuto
 * soma o combo no ritmo da peça mais lenta e o uso solo das peças mais rápidas.
 *
 * Valores absolutos não são previsões: servem para comparar estados do mesmo
 * herói no mesmo contexto. Os cenários e pesos estão aqui, à vista, para ajuste.
 */
import type { BuildResult } from "../engine/index.ts";
import { effectiveHealth } from "../optimizer/defense.ts";
import { buildEffects, type EffectDef } from "./effects.ts";
import { simulate, type Action, type Point, type Scenario, type SimResult } from "./sim.ts";

export type ScenarioId = "duel" | "skirmish" | "teamfight" | "spread" | "chase" | "dive";
export type PlanId = "control" | "damage";

export interface PlanWeights {
  /** Alvos atingidos pelas ações (por execução). */
  hits: number;
  /** Segundos de controle útil (stun 1, imobilização 0,7, lentidão pela força). */
  control: number;
  /** Dano que os aliados conseguem aplicar nos alvos presos (por 100). */
  allyDamage: number;
  /** Dano das próprias ações na janela (por 100). */
  damage: number;
  /** Concluir a sequência vivo. */
  survival: number;
}

export interface Plan {
  id: PlanId;
  label: string;
  weights: PlanWeights;
  /** Peso de cada cenário quando não se sabe o adversário (cenário assumido). */
  scenarios: Record<ScenarioId, number>;
}

const MIX: Record<ScenarioId, number> = { duel: 0.15, skirmish: 0.2, teamfight: 0.3, spread: 0.1, chase: 0.1, dive: 0.15 };

export const PLANS: Record<PlanId, Plan> = {
  control: { id: "control", label: "Controle", weights: { hits: 1, control: 1.5, allyDamage: 1, damage: 0.5, survival: 3 }, scenarios: MIX },
  damage: { id: "damage", label: "Dano sustentado", weights: { hits: 0.2, control: 0.3, allyDamage: 0.3, damage: 1.5, survival: 2 }, scenarios: MIX },
};

export const SCENARIO_LABEL: Record<ScenarioId, string> = {
  duel: "duelo",
  skirmish: "luta pequena (2)",
  teamfight: "teamfight (4 agrupados)",
  spread: "inimigos dispersos",
  chase: "perseguição",
  dive: "defesa contra iniciação",
};

/**
 * Cenários de referência. Suposições que precisam de calibração com partidas:
 * reação do inimigo, dash disponível, quem tem item de dissipar, dano da
 * iniciação (1.100 + 0,09 × souls em 2,5 s) e dano dos aliados por alvo preso.
 */
export function scenarios(souls: number, overrides: Partial<Scenario> = {}): Record<ScenarioId, Scenario> {
  const allyDps = 40 + souls * 0.004;
  const burst = 1100 + souls * 0.09;
  const base = { reaction: 0.5, canDash: true, cleansers: 0, incomingDps: 0, incomingFor: 0, allyDps, readyAt: 0, behavior: "hold" as const };
  const list: Scenario[] = [
    { ...base, id: "duel", label: SCENARIO_LABEL.duel, enemies: [{ x: 20, y: 0 }], reaction: 0.4 },
    { ...base, id: "skirmish", label: SCENARIO_LABEL.skirmish, enemies: [{ x: 20, y: 0 }, { x: 23, y: 4 }], cleansers: 1 },
    { ...base, id: "teamfight", label: SCENARIO_LABEL.teamfight, enemies: [{ x: 20, y: 0 }, { x: 23, y: 4 }, { x: 24, y: -5 }, { x: 27, y: 1 }], reaction: 0.6, canDash: false, cleansers: 1 },
    { ...base, id: "spread", label: SCENARIO_LABEL.spread, enemies: [{ x: 18, y: -9 }, { x: 24, y: 8 }, { x: 30, y: -2 }] },
    { ...base, id: "chase", label: SCENARIO_LABEL.chase, enemies: [{ x: 16, y: 0 }], behavior: "flee", reaction: 0.3 },
    { ...base, id: "dive", label: SCENARIO_LABEL.dive, enemies: [{ x: 6, y: 1 }, { x: 7, y: -2 }], behavior: "dive", canDash: false, incomingDps: burst / 2.5, incomingFor: 2.5, readyAt: 0.6 },
  ];
  return Object.fromEntries(list.map((s) => [s.id, { ...s, ...overrides }])) as Record<ScenarioId, Scenario>;
}

/** Fonte de efeitos que vira uma ação na luta (habilidade com cooldown ou item ativo, contra inimigos). */
export interface PlayAction {
  source: string;
  name: string;
  kind: "ability" | "item";
  cooldown: number;
  effects: EffectDef[];
}

const RELEVANT = new Set<EffectDef["state"]>(["pull", "immobilize", "stun", "sleep", "slow", "movementSilence", "silence", "damage", "dot", "resistShred"]);
const MAX_ACTIONS = 5;
const GLOBAL_RANGE = 100;

export function playActions(effects: EffectDef[]): PlayAction[] {
  const by = new Map<string, EffectDef[]>();
  for (const e of effects) {
    if (e.trigger === "passive" || e.trigger === "bulletHit" || e.trigger === "spiritDamage" || e.trigger === "inCombat") continue;
    if (e.target !== "enemy" && e.target !== "enemies") continue;
    if (!RELEVANT.has(e.state)) continue;
    if (e.timing.cooldown <= 0) continue;
    // Alcance global (ultimate que atravessa o mapa): sem geometria local para simular.
    if ((e.geometry.range ?? 0) > GLOBAL_RANGE) continue;
    by.set(e.source.className, [...(by.get(e.source.className) ?? []), e]);
  }
  const rank = (list: EffectDef[]) =>
    (list.some((e) => ["pull", "stun", "immobilize", "sleep"].includes(e.state)) ? 4 : 0) + (list.some((e) => (e.geometry.radius ?? 0) > 0 || e.geometry.length) ? 2 : 0) + (list.some((e) => e.state === "damage" || e.state === "dot") ? 1 : 0);
  return [...by.values()]
    .map((list) => ({ source: list[0]!.source.className, name: list[0]!.source.name, kind: list[0]!.source.kind, cooldown: list[0]!.timing.cooldown, effects: list }))
    .sort((a, b) => rank(b.effects) - rank(a.effects) || a.cooldown - b.cooldown)
    .slice(0, MAX_ACTIONS);
}

export interface Step {
  source: string;
  name: string;
  at: number;
}

export interface SequenceResult {
  steps: Step[];
  sim: SimResult;
  /** Valor de uma execução, pelos pesos do plano. */
  value: number;
  /** Segundos até o combo inteiro voltar (peça mais lenta). */
  cycle: number;
}

export interface ScenarioReport {
  id: ScenarioId;
  label: string;
  weight: number;
  best: SequenceResult | null;
  /** Valor por minuto: combo no ritmo da peça mais lenta + usos solo das mais rápidas. */
  perMinute: number;
}

export interface PlayReport {
  plan: PlanId;
  utility: number;
  scenarios: ScenarioReport[];
  actions: PlayAction[];
  ehp: number;
}

export function executionValue(sim: SimResult, w: PlanWeights, planned: number): number {
  const hits = Object.values(sim.hits).reduce((s, n) => s + n, 0);
  const completion = sim.casterAlive ? 1 : sim.cast.length / Math.max(1, planned);
  return w.hits * hits + w.control * sim.control + (w.allyDamage * sim.allyDamage) / 100 + (w.damage * sim.damage) / 100 + w.survival * completion * (sim.cast.length > 0 ? 1 : 0);
}

const travelOf = (a: PlayAction, distance: number) => {
  const speed = Math.max(0, ...a.effects.filter((e) => !e.geometry.length).map((e) => e.geometry.speed ?? 0));
  return speed > 0 ? distance / speed : 0;
};
const castOf = (a: PlayAction) => a.effects[0]?.timing.castDelay ?? 0;
const resolveOf = (a: PlayAction) => Math.max(0, ...a.effects.map((e) => (e.trigger === "resolve" ? e.timing.resolveDelay : 0)));
const restraintOf = (a: PlayAction) => Math.max(0, ...a.effects.filter((e) => ["pull", "immobilize", "stun"].includes(e.state)).map((e) => e.timing.duration));

/**
 * Intervalos candidatos para lançar `b` depois de `a`: em seguida, sincronizado
 * para `b` resolver quando a restrição de `a` termina, sincronizado para a
 * restrição de `b` acabar quando `a` detona, e depois de tudo (encadear controle).
 */
function offsets(a: PlayAction, b: PlayAction, distance: number): number[] {
  const min = castOf(a) + 0.05;
  const aLand = castOf(a) + travelOf(a, distance);
  const bLand = castOf(b) + travelOf(b, distance);
  const aEnd = aLand + restraintOf(a);
  const out = [min];
  if (resolveOf(b) > 0) out.push(aEnd - (castOf(b) + resolveOf(b)) + 0.05);
  if (resolveOf(a) > 0) out.push(aLand + resolveOf(a) - (bLand + restraintOf(b)) - 0.05);
  out.push(aLand + resolveOf(a) + Math.max(restraintOf(a), ...a.effects.filter((e) => e.trigger === "resolve").map((e) => e.timing.duration)));
  // Intervalo executável numa luta: nada de esperar mais que alguns segundos entre ações.
  return [...new Set(out.map((x) => Math.round(Math.min(MAX_GAP, Math.max(min, x)) * 20) / 20))];
}

const BEAM = 5;
const MAX_GAP = 2.5;
const DEPTH = 3;

/** Melhor sequência de até 3 ações num cenário (busca em feixe sobre ordem e intervalo). */
export function bestSequence(actions: PlayAction[], scenario: Scenario, ehp: number, plan: Plan, disable?: (e: EffectDef) => boolean): { best: SequenceResult | null; solo: Map<string, number> } {
  const engaged = actions.some((a) => a.effects.some((e) => e.origin === "caster"));
  const n = scenario.enemies.length;
  const centroid: Point = scenario.enemies.reduce((s, e) => ({ x: s.x + e.x / n, y: s.y + e.y / n }), { x: 0, y: 0 });
  const aim = scenario.behavior === "flee" ? undefined : centroid;
  const distance = Math.hypot(centroid.x, centroid.y);
  const effectsOf = (a: PlayAction) => (disable ? a.effects.filter((e) => !disable(e)) : a.effects);
  const run = (steps: { a: PlayAction; at: number }[]): SequenceResult => {
    const acts: Action[] = steps.map((s) => ({ source: s.a.source, name: s.a.name, at: s.at, effects: effectsOf(s.a), ...(aim ? { aim } : {}) }));
    const sim = simulate(scenario, acts, { ehp, engaged });
    return { steps: steps.map((s) => ({ source: s.a.source, name: s.a.name, at: s.at })), sim, value: executionValue(sim, plan.weights, steps.length), cycle: Math.max(...steps.map((s) => s.a.cooldown)) };
  };
  const solo = new Map<string, number>();
  let beam: { steps: { a: PlayAction; at: number }[]; r: SequenceResult }[] = [];
  for (const a of actions) {
    const r = run([{ a, at: 0 }]);
    solo.set(a.source, r.value);
    beam.push({ steps: [{ a, at: 0 }], r });
  }
  const perMinute = (r: SequenceResult) => (r.value * 60) / Math.max(r.cycle, 1);
  let best = beam.reduce<SequenceResult | null>((b, x) => (!b || perMinute(x.r) > perMinute(b) ? x.r : b), null);
  beam = beam.sort((x, y) => y.r.value - x.r.value).slice(0, BEAM);
  for (let depth = 2; depth <= DEPTH; depth++) {
    const next: typeof beam = [];
    for (const node of beam) {
      const last = node.steps[node.steps.length - 1]!;
      for (const b of actions) {
        if (node.steps.some((s) => s.a.source === b.source)) continue;
        for (const off of offsets(last.a, b, distance)) {
          const steps = [...node.steps, { a: b, at: last.at + off }];
          next.push({ steps, r: run(steps) });
        }
      }
    }
    if (!next.length) break;
    // A melhor jogada sai de tudo o que foi simulado, não só do que segue no feixe.
    for (const x of next) if (!best || rotation(x.r, solo, actions) > rotation(best, solo, actions)) best = x.r;
    beam = next.sort((x, y) => y.r.value - x.r.value).slice(0, BEAM);
  }
  return { best, solo };
}

/** Valor por minuto: o combo a cada `cycle` s mais as peças rápidas usadas sozinhas entre um combo e outro. */
export function rotation(r: SequenceResult, solo: Map<string, number>, actions: PlayAction[]): number {
  let total = (r.value * 60) / Math.max(r.cycle, 1);
  for (const s of r.steps) {
    const a = actions.find((x) => x.source === s.source);
    if (!a || a.cooldown >= r.cycle) continue;
    total += Math.max(0, 60 / a.cooldown - 60 / r.cycle) * (solo.get(a.source) ?? 0);
  }
  return total;
}

export interface PlayOptions {
  /** Só estes cenários (padrão: os do plano). */
  only?: ScenarioId[];
  /** Ajustes dos cenários (aliado prendendo o alvo, por exemplo). */
  scenario?: Partial<Scenario>;
  /** Tira efeitos da conta (atribuição: repetir sem o efeito de preparo). */
  disable?: (e: EffectDef) => boolean;
  /** Usa outra vida efetiva (atribuição da parte de execução). */
  ehp?: number;
}

const cache = new Map<string, PlayReport>();
const round = (x: number) => Math.round(x * 20) / 20;

/** U(estado, contexto): valor das jogadas da build num plano. */
export function playReport(build: BuildResult, planId: PlanId, opts: PlayOptions = {}): PlayReport {
  const plan = PLANS[planId];
  const effects = buildEffects(build, 0);
  const actions = playActions(effects);
  const ehp = opts.ehp ?? effectiveHealth(build);
  const key =
    !opts.disable && !opts.scenario
      ? JSON.stringify([planId, Math.round(build.souls / 500), Math.round(ehp / 100), opts.only ?? null, actions.map((a) => [a.source, round(a.cooldown), a.effects.map((e) => [e.state, round(e.magnitude), round(e.geometry.radius ?? 0), round(e.timing.duration), round(e.geometry.length ?? 0)])])])
      : null;
  if (key && cache.has(key)) return cache.get(key)!;
  const all = scenarios(build.souls, opts.scenario);
  const ids = (opts.only ?? (Object.keys(plan.scenarios) as ScenarioId[])).filter((id) => (opts.only ? true : plan.scenarios[id] > 0));
  const reports: ScenarioReport[] = ids.map((id) => {
    const { best, solo } = bestSequence(actions, all[id], ehp, plan, opts.disable);
    const weight = opts.only ? 1 / ids.length : plan.scenarios[id];
    return { id, label: all[id].label, weight, best, perMinute: best ? rotation(best, solo, actions) : 0 };
  });
  const report: PlayReport = { plan: planId, utility: reports.reduce((s, r) => s + r.weight * r.perMinute, 0), scenarios: reports, actions, ehp };
  if (key) {
    if (cache.size > 5000) cache.clear();
    cache.set(key, report);
  }
  return report;
}

/**
 * Valor esperado de uma habilidade: magnitude × chance de acerto. Mostra por que
 * subir o acerto (preparo) pode valer mais que subir o dano. Em produção a chance
 * vem de medição (replays); sem ela, o app mostra só a condição e a direção.
 */
export const expectedValue = (magnitude: number, hitRate: number) => magnitude * hitRate;

export const playUtility =(build: BuildResult, planId: PlanId, opts?: PlayOptions) => playReport(build, planId, opts).utility;
