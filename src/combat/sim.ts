/**
 * Simulação simplificada de uma sequência de ações num cenário.
 *
 * Plano 2D em metros, passo fixo de 50 ms com eventos agendados (lançamento,
 * chegada, detonação, ticks). Modela quem pode agir (stun e sono tiram ações;
 * imobilização só tira movimento), posições, entrada e fim de cada efeito, e as
 * respostas do inimigo: sair da área, dash, dissipar. Não modela mira humana,
 * terreno nem linha de visão.
 */
import type { Counter, EffectDef } from "./effects.ts";

export interface Point {
  x: number;
  y: number;
}

export interface Scenario {
  id: string;
  label: string;
  /** Inimigos no início da luta (metros; o herói começa na origem). */
  enemies: Point[];
  /** hold: ficam até perceber a ameaça; flee: fogem em +x; dive: vão para cima do herói. */
  behavior: "hold" | "flee" | "dive";
  /** Tempo até o inimigo reagir a uma área marcada (s). */
  reaction: number;
  /** Inimigos podem usar dash para sair da área. */
  canDash: boolean;
  /** Quantos inimigos (os primeiros) têm um item de dissipar. */
  cleansers: number;
  /** Aliado já prende um alvo: índice, até quando e com qual controle. */
  allyHold?: { target: number; until: number; state: "stun" | "immobilize" };
  /** Dano por segundo que o herói recebe no início (iniciação inimiga) e por quanto tempo. */
  incomingDps: number;
  incomingFor: number;
  /** Dano por segundo dos aliados em cada alvo preso. */
  allyDps: number;
  /** Momento em que o herói consegue começar a agir (reação à iniciação). */
  readyAt: number;
}

export interface Action {
  source: string;
  name: string;
  at: number;
  effects: EffectDef[];
  /** Ponto de mira planejado (áreas). */
  aim?: Point;
}

export interface Caster {
  /** Vida efetiva do herói (morre ao passar dela). */
  ehp: number;
  /** Começa junto dos inimigos (kits com efeitos centrados no herói). */
  engaged: boolean;
}

export interface EnemyOutcome {
  /** Segundos de controle ponderados (o maior efeito em cada instante; sobreposição não soma). */
  control: number;
  /** Segundos presos (stun, sono, imobilização, puxão). */
  hard: number;
  damage: number;
  allyDamage: number;
}

export interface SimResult {
  enemies: EnemyOutcome[];
  /** Por fonte: inimigos atingidos quando o efeito resolve (área atrasada) ou chega. */
  hits: Record<string, number>;
  /** Por fonte: inimigos que estavam na área ao marcar e saíram antes de resolver. */
  escaped: Record<string, number>;
  control: number;
  hard: number;
  damage: number;
  allyDamage: number;
  casterAlive: boolean;
  /** Ações efetivamente lançadas (o herói estava vivo e pronto). */
  cast: string[];
  /** Linha do tempo resumida, para explicar a jogada. */
  log: string[];
}

const DT = 0.05;
const ENEMY_SPEED = 6.9;
const DASH_DISTANCE = 10;
const DASH_TIME = 0.72;
const CLEANSE_DELAY = 0.5;
/** Duração máxima simulada (s). */
const MAX_HORIZON = 10;

/** Peso de cada controle no "controle útil": stun e sono tiram ações; imobilizado ainda atira e lança. */
export const CONTROL_WEIGHT: Partial<Record<EffectDef["state"], number>> = { stun: 1, sleep: 1, immobilize: 0.7, pull: 0.7, silence: 0.6, movementSilence: 0.2 };
const SLOW_WEIGHT = 0.5;
// Classes de cada estado, calculadas quando o efeito entra (o estado, a força e a fonte não mudam depois).
/** Prende: stun, sono, imobilização, puxão. */
const F_HARD = 1;
/** Impede o dash: silêncio de movimento, silêncio, stun, sono. */
const F_NO_DASH = 2;
/** Impede a resposta (dissipar): stun, sono, silêncio. */
const F_DENIAL = 4;
const F_SLOW = 8;
const F_SHRED = 16;
/** Efeito nosso (não do aliado que já prendia o alvo). */
const F_OURS = 32;

function stateFlags(state: EffectDef["state"], source: string): number {
  let f = source !== "aliado" ? F_OURS : 0;
  if (state === "stun" || state === "sleep" || state === "immobilize" || state === "pull") f |= F_HARD;
  if (state === "movementSilence" || state === "silence" || state === "stun" || state === "sleep") f |= F_NO_DASH;
  if (state === "stun" || state === "sleep" || state === "silence") f |= F_DENIAL;
  if (state === "slow") f |= F_SLOW;
  if (state === "resistShred") f |= F_SHRED;
  return f;
}

/** Peso do efeito no controle útil (lentidão pela força). */
const stateWeight = (state: EffectDef["state"], magnitude: number) => (state === "slow" ? (magnitude / 100) * SLOW_WEIGHT : (CONTROL_WEIGHT[state] ?? 0));

type Status = { state: EffectDef["state"]; at: number; until: number; magnitude: number; source: string; cleansable: boolean; dashReduction: number; breaksOnDamage: boolean; weight: number; flags: number };

function status(state: EffectDef["state"], at: number, until: number, magnitude: number, source: string, cleansable: boolean, dashReduction: number, breaksOnDamage: boolean): Status {
  return { state, at, until, magnitude, source, cleansable, dashReduction, breaksOnDamage, weight: stateWeight(state, magnitude), flags: stateFlags(state, source) };
}
type Enemy = { pos: Point; statuses: Status[]; dashUntil: number; dashDir: Point | null; dashed: boolean; cleansed: boolean; fleeFrom: Point | null; fleeAt: number; out: EnemyOutcome; pull: { from: Point; to: Point; start: number; end: number } | null };
type Zone = { source: string; center: Point; radius: number; resolveAt: number; inside: Set<number>; aura: EffectDef[] };
type Trail = { source: string; from: Point; dir: Point; length: number; width: number; speed: number; start: number; end: number; dps: number; tick: number; nextTick: number; hitInitial: Set<number>; initial: number; initialRadius: number; dotRef: number; initialRef: number };
type Event = { t: number; run: () => void };

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const norm = (p: Point): Point => {
  const d = Math.hypot(p.x, p.y) || 1;
  return { x: p.x / d, y: p.y / d };
};

/**
 * Gravação de uma simulação para reaproveitar com outros números de dano. O dano
 * (efeitos "damage" e "dot") não muda nenhuma decisão da simulação: só soma em
 * `out.damage`. Então a mesma "forma" (tudo menos as magnitudes de dano e o dano dos
 * aliados) dá o mesmo controle, acertos, log e ordem de golpes; basta refazer as somas
 * de dano na mesma ordem, com as mesmas operações, para ter o resultado idêntico.
 */
interface Recorder {
  /** Posição de cada efeito: ação × 65536 + índice nos efeitos da ação. */
  refOf: Map<EffectDef, number>;
  /** Golpes em ordem, 4 números cada: inimigo, tipo (0 efeito, 1 dano inicial do rastro, 2 tique do rastro), posição, multiplicador. */
  tape: number[];
  /** Passos de cada inimigo em que o dano dos aliados somou. */
  allyTicks: number[];
}

interface Shape {
  control: number[];
  hard: number[];
  allyTicks: number[];
  tape: number[];
  hits: Record<string, number>;
  escaped: Record<string, number>;
  casterAlive: boolean;
  cast: string[];
  log: string[];
}

const SHAPE_CACHE_LIMIT = 30000;
const shapeCache = new Map<string, Shape>();
// Cenários e efeitos viram números curtos na chave (descrições iguais, mesmo número).
// Os números nunca se repetem, então limpar a tabela não confunde chaves antigas.
const interned = new Map<string, number>();
let nextId = 0;
const intern = (text: string) => {
  let id = interned.get(text);
  if (id === undefined) interned.set(text, (id = nextId++));
  return id;
};
const scenarioIds = new WeakMap<Scenario, number>();
const effectIds = new WeakMap<EffectDef, number>();

const scenarioKey = (scenario: Scenario) => {
  let id = scenarioIds.get(scenario);
  if (id === undefined) {
    // O dano dos aliados só soma em allyDamage (e acorda quem dorme, se for positivo).
    // O dano da iniciação só decide em que passo o herói cai (entra na chave pela vida).
    const { allyDps, incomingDps: _incomingDps, ...rest } = scenario;
    scenarioIds.set(scenario, (id = intern(JSON.stringify(["s", rest, allyDps > 0]))));
  }
  return id;
};
/**
 * Só os campos do efeito que a simulação lê (String distingue undefined, null e NaN).
 * A força só pesa em lentidão e redução de resistência: nos outros estados ela não
 * entra em nenhuma decisão, e o dano é refeito na gravação.
 */
const effectKey = (eff: EffectDef) => {
  let id = effectIds.get(eff);
  if (id === undefined) {
    const { timing: tm, geometry: g, rules: r } = eff;
    const strength = eff.state === "slow" || eff.state === "resistShred" ? String(eff.magnitude) : "";
    const fields = [eff.state, strength, eff.source.className, eff.trigger, eff.origin, eff.target, (eff.counters as Counter[]).join(","), r.stacking, r.breaksOnDamage, r.dashReduction, r.pullTo, tm.castDelay, tm.resolveDelay, tm.duration, tm.tickInterval, g.radius, g.length, g.width, g.speed];
    effectIds.set(eff, (id = intern(`e\u0003${fields.map(String).join("\u0003")}`)));
  }
  return id;
};
/** Parte da chave de uma lista de efeitos (a mesma lista vem em todas as simulações de uma busca). */
const listKeys = new WeakMap<EffectDef[], string | null>();
const listKey = (effects: EffectDef[]) => {
  let key = listKeys.get(effects);
  if (key === undefined) {
    // O mesmo objeto duas vezes na lista: a gravação não saberia de qual posição veio o dano.
    key = new Set(effects).size === effects.length ? effects.map(effectKey).join(",") : null;
    listKeys.set(effects, key);
  }
  return key;
};

/**
 * Passo em que o herói cai sob a iniciação (-1 se não cai), com a mesma conta e a
 * mesma sequência de tempos da simulação. Depois do horizonte máximo a simulação já acabou.
 */
function deathTick(scenario: Scenario, ehp: number): number {
  let damageTaken = 0;
  let k = 0;
  for (let t = 0; t <= MAX_HORIZON + 1e-9 && t < scenario.incomingFor; t += DT, k++) {
    damageTaken += scenario.incomingDps * DT;
    if (damageTaken >= ehp) return k;
  }
  return -1;
}

/** Chave da forma da simulação, ou null quando um mesmo efeito aparece em duas posições (sem cache). */
function shapeKey(scenario: Scenario, actions: Action[], caster: Caster): string | null {
  // Vida efetiva e dano da iniciação só decidem o passo em que o herói cai.
  let key = `${scenarioKey(scenario)}\u0001${caster.engaged}\u0001${deathTick(scenario, caster.ehp)}`;
  for (let ai = 0; ai < actions.length; ai++) {
    const a = actions[ai]!;
    const effects = listKey(a.effects);
    if (effects === null) return null;
    // Um mesmo efeito em duas ações (raro): sem cache, pelo mesmo motivo.
    for (let bi = 0; bi < ai; bi++) for (const eff of a.effects) if (actions[bi]!.effects.includes(eff)) return null;
    key += `\u0001${a.source}\u0002${a.name}\u0002${a.at}\u0002${a.aim ? `${a.aim.x},${a.aim.y}` : "-"}\u0002${effects}`;
  }
  return key;
}

/** Posição de cada efeito nas ações (sem repetidos: garantido pela chave). */
function positions(actions: Action[]): Map<EffectDef, number> {
  const refOf = new Map<EffectDef, number>();
  actions.forEach((a, ai) => a.effects.forEach((eff, ei) => refOf.set(eff, ai * 65536 + ei)));
  return refOf;
}

/** Dano de um golpe gravado, com as magnitudes das ações atuais (a mesma conta da simulação). */
function tapeAmount(actions: Action[], kind: number, ref: number): number {
  if (ref < 0) return 0;
  const eff = actions[Math.floor(ref / 65536)]!.effects[ref % 65536]!;
  if (kind === 0) return eff.magnitude;
  if (kind === 1) return eff.magnitude ?? 0;
  return eff.magnitude * (eff.timing.tickInterval ?? 0.5);
}

function replay(shape: Shape, scenario: Scenario, actions: Action[]): SimResult {
  const outs: EnemyOutcome[] = shape.control.map((control, i) => ({ control, hard: shape.hard[i]!, damage: 0, allyDamage: 0 }));
  const tape = shape.tape;
  for (let k = 0; k < tape.length; k += 4) {
    const amount = tapeAmount(actions, tape[k + 1]!, tape[k + 2]!);
    const dealt = amount * tape[k + 3]!;
    outs[tape[k]!]!.damage += dealt;
  }
  for (let i = 0; i < outs.length; i++) for (let n = shape.allyTicks[i]!; n > 0; n--) outs[i]!.allyDamage += scenario.allyDps * DT;
  return result(outs, { ...shape.hits }, { ...shape.escaped }, shape.casterAlive, [...shape.cast], [...shape.log]);
}

function result(outs: EnemyOutcome[], hits: Record<string, number>, escaped: Record<string, number>, casterAlive: boolean, cast: string[], log: string[]): SimResult {
  const sum = (k: keyof EnemyOutcome) => outs.reduce((s, e) => s + e[k], 0);
  return { enemies: outs, hits, escaped, control: sum("control"), hard: sum("hard"), damage: sum("damage"), allyDamage: sum("allyDamage"), casterAlive, cast, log };
}

export function simulate(scenario: Scenario, actions: Action[], caster: Caster): SimResult {
  const key = shapeKey(scenario, actions, caster);
  if (key === null) return simulateCore(scenario, actions, caster, null);
  const hit = shapeCache.get(key);
  if (hit) return replay(hit, scenario, actions);
  const rec: Recorder = { refOf: positions(actions), tape: [], allyTicks: scenario.enemies.map(() => 0) };
  const out = simulateCore(scenario, actions, caster, rec);
  if (shapeCache.size >= SHAPE_CACHE_LIMIT) {
    shapeCache.clear();
    interned.clear();
  }
  shapeCache.set(key, {
    control: out.enemies.map((e) => e.control),
    hard: out.enemies.map((e) => e.hard),
    allyTicks: rec.allyTicks,
    tape: rec.tape,
    hits: { ...out.hits },
    escaped: { ...out.escaped },
    casterAlive: out.casterAlive,
    cast: [...out.cast],
    log: [...out.log],
  });
  return out;
}

function simulateCore(scenario: Scenario, actions: Action[], caster: Caster, rec: Recorder | null): SimResult {
  const centroid0 = scenario.enemies.reduce((s, e) => ({ x: s.x + e.x / scenario.enemies.length, y: s.y + e.y / scenario.enemies.length }), { x: 0, y: 0 });
  const casterPos: Point = caster.engaged ? { x: centroid0.x - 2, y: centroid0.y } : { x: 0, y: 0 };
  const enemies: Enemy[] = scenario.enemies.map((p) => ({
    pos: { ...p },
    statuses: [],
    dashUntil: -1,
    dashDir: null,
    dashed: false,
    cleansed: false,
    fleeFrom: null,
    fleeAt: Infinity,
    out: { control: 0, hard: 0, damage: 0, allyDamage: 0 },
    pull: null,
  }));
  if (scenario.allyHold) {
    const e = enemies[scenario.allyHold.target];
    if (e) e.statuses.push(status(scenario.allyHold.state, 0, scenario.allyHold.until, 1, "aliado", false, 0, false));
  }
  const hits: Record<string, number> = {};
  const escaped: Record<string, number> = {};
  const cast: string[] = [];
  const log: string[] = [];
  const zones: Zone[] = [];
  const trails: Trail[] = [];
  const events: Event[] = [];
  let damageTaken = 0;
  let alive = true;

  const has = (e: Enemy, t: number, flag: number) => {
    for (const s of e.statuses) if (s.until > t && s.flags & flag) return true;
    return false;
  };
  const centroid = (): Point => {
    const n = enemies.length;
    return enemies.reduce((s, e) => ({ x: s.x + e.pos.x / n, y: s.y + e.pos.y / n }), { x: 0, y: 0 });
  };
  const shredOf = (e: Enemy, t: number) => {
    let max = 0;
    for (const s of e.statuses) if (s.until > t && s.flags & F_SHRED) max = Math.max(max, s.magnitude);
    return max;
  };
  const hurt = (i: number, amount: number, t: number, source: string, kind: number, ref: number) => {
    const e = enemies[i]!;
    const mult = 1 + shredOf(e, t) / 100;
    const dealt = amount * mult;
    e.out.damage += dealt;
    if (rec) rec.tape.push(i, kind, ref, mult);
    // Dano acorda quem dorme (Sleep Dagger): efeito negativo entre ações.
    for (const s of e.statuses) if (s.state === "sleep" && s.breaksOnDamage && s.until > t + 0.1 && s.source !== source) s.until = t + 0.1;
  };
  const apply = (i: number, eff: EffectDef, t: number, duration = eff.timing.duration) => {
    const e = enemies[i]!;
    if (eff.state === "damage") return hurt(i, eff.magnitude, t, eff.source.className, 0, rec ? rec.refOf.get(eff)! : -1);
    if (duration <= 0 && eff.state !== "pull") return;
    if (eff.state === "pull") return;
    const cleansable = (eff.counters as Counter[]).includes("dispel") && eff.state !== "stun" && eff.state !== "sleep";
    // Renovação: o mesmo efeito da mesma fonte só estende a duração.
    const same = e.statuses.find((s) => s.state === eff.state && s.source === eff.source.className && s.until >= t);
    if (same) {
      same.until = Math.max(same.until, t + duration);
      return;
    }
    e.statuses.push(status(eff.state, t, t + duration, eff.magnitude, eff.source.className, cleansable, eff.rules.dashReduction ? eff.rules.dashReduction : 0, eff.rules.breaksOnDamage ? true : false));
  };
  const inArea = (center: Point, radius: number) => {
    const out: number[] = [];
    for (let i = 0; i < enemies.length; i++) if (dist(enemies[i]!.pos, center) <= radius) out.push(i);
    return out;
  };
  /** Nenhum rastro por vir ou ativo, nenhum efeito ativo nem puxão em curso em `t` (e nem depois: só eventos criam novos). */
  const quiet = (t: number) => {
    for (const tr of trails) if (!(t > tr.end)) return false;
    for (const e of enemies) {
      if (e.pull && t < e.pull.end) return false;
      for (const s of e.statuses) if (s.until > t) return false;
    }
    return true;
  };
  // Eventos só precisam ser reordenados quando entra um novo (a ordenação é estável).
  let unsorted = false;
  const schedule = (event: Event) => {
    events.push(event);
    unsorted = true;
  };

  for (const action of actions) {
    const effects = action.effects;
    if (effects.length === 0) continue;
    const first = effects[0]!;
    const castEnd = Math.max(action.at, scenario.readyAt) + first.timing.castDelay;
    schedule({
      t: castEnd,
      run: () => {
        if (!alive) return;
        cast.push(action.source);
        const t0 = castEnd;
        // Mira: centro dos inimigos agora (área), o alvo principal (alvo único) ou o próprio herói.
        // Área: o ponto planejado da sequência (onde o puxão junta os alvos), ou o centro deles agora.
        const aim = first.origin === "caster" ? casterPos : first.origin === "target" ? enemies[0]!.pos : (action.aim ?? centroid());
        const center = { ...aim };
        // Rastro (Bookwyrm) aparece no ponto: a velocidade é a do dragão, não a de viagem até lá.
        const speed = Math.max(0, ...effects.filter((e) => !e.geometry.length).map((e) => e.geometry.speed ?? 0));
        const travel = speed > 0 && first.origin !== "caster" ? dist(casterPos, center) / speed : 0;
        const landing = t0 + travel;
        const resolveDelay = Math.max(...effects.map((e) => (e.trigger === "resolve" ? e.timing.resolveDelay : 0)));
        log.push(`${t0.toFixed(2)}s ${action.name} lançada${travel > 0 ? `, chega em ${landing.toFixed(2)}s` : ""}${resolveDelay > 0 ? `, resolve em ${(landing + resolveDelay).toFixed(2)}s` : ""}`);
        const targetIdx = first.origin === "target" ? [0] : null;
        const radiusOf = (e: EffectDef) => e.geometry.radius ?? 0;
        schedule({
          t: landing,
          run: () => {
            const landed = new Set<number>();
            const followTarget = first.origin === "target";
            if (resolveDelay > 0 && !followTarget) {
              const delayed = effects.filter((e) => e.trigger === "resolve");
              const radius = Math.max(...delayed.map(radiusOf));
              const zone: Zone = { source: action.source, center, radius, resolveAt: landing + resolveDelay, inside: new Set(inArea(center, radius)), aura: effects.filter((e) => e.trigger === "landing" && e.state === "slow" && e.rules.stacking === "refresh") };
              zones.push(zone);
              for (const i of zone.inside) {
                const e = enemies[i]!;
                if (!e.fleeFrom && (delayed[0]!.counters.includes("leaveArea") || delayed[0]!.counters.includes("dash"))) {
                  e.fleeFrom = center;
                  e.fleeAt = landing + scenario.reaction;
                }
              }
            }
            for (const eff of effects) {
              if (eff.trigger === "resolve" && resolveDelay > 0) continue;
              if (eff.state === "dot" && eff.geometry.length) {
                const dir = norm({ x: center.x - casterPos.x, y: center.y - casterPos.y });
                const len = eff.geometry.length;
                const from = { x: center.x - dir.x * 3, y: center.y - dir.y * 3 };
                const dmg = effects.find((x) => x.state === "damage");
                trails.push({ source: action.source, from, dir, length: len, width: eff.geometry.width ?? (eff.geometry.radius ?? 3) * 0.75, speed: eff.geometry.speed ?? 20, start: landing, end: landing + len / (eff.geometry.speed ?? 20) + eff.timing.duration, dps: eff.magnitude, tick: eff.timing.tickInterval ?? 0.5, nextTick: landing, hitInitial: new Set(), initial: dmg?.magnitude ?? 0, initialRadius: dmg?.geometry.radius ?? 4, dotRef: rec ? rec.refOf.get(eff)! : -1, initialRef: rec && dmg ? rec.refOf.get(dmg)! : -1 });
                continue;
              }
              if (eff.state === "damage" && effects.some((x) => x.state === "dot" && x.geometry.length)) continue; // dano inicial vai com o rastro
              if (eff.target === "self" || eff.target === "ally") continue;
              const targets = targetIdx ?? (eff.geometry.radius ? inArea(center, eff.geometry.radius) : [0]);
              if (eff.state === "pull") {
                for (const i of targets) {
                  const e = enemies[i]!;
                  const to = { x: center.x + (e.pos.x - center.x) * 0.1, y: center.y + (e.pos.y - center.y) * 0.1 };
                  const d = dist(to, center);
                  const pullTo = eff.rules.pullTo ?? 1.5;
                  const final = d > pullTo ? { x: center.x + ((to.x - center.x) * pullTo) / d, y: center.y + ((to.y - center.y) * pullTo) / d } : to;
                  e.pull = { from: { ...e.pos }, to: final, start: landing, end: landing + Math.max(eff.timing.duration, DT) };
                  e.dashUntil = -1;
                }
                for (const i of targets) landed.add(i);
                continue;
              }
              for (const i of targets) apply(i, eff, landing);
              if (resolveDelay === 0 && eff.state !== "slow") for (const i of targets) landed.add(i);
            }
            if (landed.size) hits[action.source] = (hits[action.source] ?? 0) + landed.size;
            if (resolveDelay > 0 && followTarget) {
              schedule({
                t: landing + resolveDelay,
                run: () => {
                  const delayed = effects.filter((e) => e.trigger === "resolve" || e.timing.resolveDelay > 0);
                  for (const eff of delayed) apply(0, eff, landing + resolveDelay);
                  hits[action.source] = (hits[action.source] ?? 0) + 1;
                },
              });
            }
            if (resolveDelay > 0 && !followTarget) {
              schedule({
                t: landing + resolveDelay,
                run: () => {
                  const tr = landing + resolveDelay;
                  const delayed = effects.filter((e) => e.trigger === "resolve");
                  const radius = Math.max(...delayed.map(radiusOf));
                  const c = first.origin === "caster" ? casterPos : center;
                  const inside = inArea(c, radius);
                  const zone = zones.find((z) => z.source === action.source && z.resolveAt === tr);
                  for (const eff of delayed) for (const i of inside) apply(i, eff, tr);
                  hits[action.source] = (hits[action.source] ?? 0) + inside.length;
                  const out = zone ? [...zone.inside].filter((i) => !inside.includes(i)).length : 0;
                  escaped[action.source] = (escaped[action.source] ?? 0) + out;
                  log.push(`${tr.toFixed(2)}s ${action.name} resolve: ${inside.length} dentro${out ? `, ${out} escapou` : ""}`);
                  for (const e of enemies) if (e.fleeFrom === center) e.fleeFrom = null;
                  if (zone) zones.splice(zones.indexOf(zone), 1);
                },
              });
            }
          },
        });
      },
    });
  }

  const lastAt = Math.max(0, ...actions.map((a) => a.at + Math.max(0, ...a.effects.map((e) => e.timing.castDelay + e.timing.resolveDelay + e.timing.duration + 1.5))));
  const horizon = Math.min(MAX_HORIZON, Math.max(lastAt, scenario.readyAt + 2));
  for (let t = 0; t <= horizon + 1e-9; t += DT) {
    // Nada mais acontece: sem eventos, áreas, rastros, efeitos ativos nem dano chegando.
    // O resto do horizonte só moveria os inimigos, o que não entra no resultado.
    if ((!alive || t >= scenario.incomingFor) && events.length === 0 && zones.length === 0 && quiet(t)) break;
    // Herói sob iniciação: morre se o dano passar da vida efetiva antes de lançar.
    if (alive && t < scenario.incomingFor) {
      damageTaken += scenario.incomingDps * DT;
      if (damageTaken >= caster.ehp) {
        alive = false;
        log.push(`${t.toFixed(2)}s herói abatido antes de concluir a sequência`);
      }
    }
    if (unsorted) {
      events.sort((a, b) => a.t - b.t);
      unsorted = false;
    }
    while (events.length && events[0]!.t <= t + 1e-9) events.shift()!.run();

    // Área marcada com lentidão renovada enquanto o alvo está dentro (Captivating Read).
    for (const z of zones) for (const eff of z.aura) for (const i of inArea(z.center, z.radius)) apply(i, eff, t, Math.max(eff.timing.duration, DT));

    for (const tr of trails) {
      if (t < tr.start || t > tr.end) continue;
      const head = Math.min(tr.length, (t - tr.start) * tr.speed);
      for (let i = 0; i < enemies.length; i++) {
        const pos = enemies[i]!.pos;
        const rx = pos.x - tr.from.x;
        const ry = pos.y - tr.from.y;
        const along = rx * tr.dir.x + ry * tr.dir.y;
        const across = Math.abs(rx * -tr.dir.y + ry * tr.dir.x);
        if (!tr.hitInitial.has(i) && along >= 0 && along <= head && across <= tr.initialRadius) {
          tr.hitInitial.add(i);
          hurt(i, tr.initial, t, tr.source, 1, tr.initialRef);
        }
      }
      if (t + 1e-9 >= tr.nextTick) {
        tr.nextTick += tr.tick;
        for (let i = 0; i < enemies.length; i++) {
          const pos = enemies[i]!.pos;
          const rx = pos.x - tr.from.x;
          const ry = pos.y - tr.from.y;
          const along = rx * tr.dir.x + ry * tr.dir.y;
          const across = Math.abs(rx * -tr.dir.y + ry * tr.dir.x);
          if (along >= 0 && along <= head && across <= tr.width) hurt(i, tr.dps * tr.tick, t, tr.source, 2, tr.dotRef);
        }
      }
    }

    // Efeito que acabou antes de qualquer momento ainda por vir (este passo ou um evento na fila,
    // e eventos só agendam outros depois deles) não volta: não renova, não conta e não muda.
    // Sai da lista para ela não crescer a cada renovação que chega um passo atrasada.
    let horizonFloor = t;
    for (const ev of events) if (ev.t < horizonFloor) horizonFloor = ev.t;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i]!;
      // Dissipar: o inimigo com o item tira imobilização e lentidão se ainda pode agir.
      // Stun, sono e silêncio impedem a resposta; imobilizado ainda usa o item.
      if (i < scenario.cleansers && !e.cleansed && !has(e, t, F_DENIAL)) {
        let since = Infinity;
        for (const s of e.statuses) if (s.cleansable && s.until > t) since = Math.min(since, s.at);
        if (Number.isFinite(since) && t - since >= CLEANSE_DELAY) {
          for (const s of e.statuses) if (s.cleansable) s.until = Math.min(s.until, t);
          e.cleansed = true;
          log.push(`${t.toFixed(2)}s inimigo ${i + 1} dissipa os efeitos`);
        }
      }
      // Controle útil: o maior peso ativo no instante (controles sobrepostos não somam).
      // Uma passada pelos efeitos ativos junta tudo o que o resto do passo consulta.
      const pulling = e.pull && t >= e.pull.start && t < e.pull.end;
      let w = pulling ? CONTROL_WEIGHT.pull! : 0;
      let hardActive = false;
      let oursActive = false;
      let silenced = false;
      let slow = 0;
      let expired = 0;
      for (const s of e.statuses) {
        if (!(s.until > t)) {
          if (s.until < horizonFloor) expired++;
          continue;
        }
        const flags = s.flags;
        w = Math.max(w, s.weight);
        if (flags & F_HARD) hardActive = true;
        if (flags & F_NO_DASH) silenced = true;
        if (flags & F_SLOW) slow = Math.max(slow, s.magnitude);
        if (flags & F_OURS) oursActive = true;
      }
      if (expired > 0) e.statuses = e.statuses.filter((s) => !(s.until < horizonFloor));
      const hard = pulling || hardActive;
      const ours = oursActive || pulling;
      if (ours) e.out.control += w * DT;
      if (hard && ours) {
        e.out.hard += DT;
        e.out.allyDamage += scenario.allyDps * DT;
        if (rec) rec.allyTicks[i]!++;
        // Dano dos aliados acorda quem dorme (uma vez: o sono acaba logo depois).
        if (scenario.allyDps > 0) for (const s of e.statuses) if (s.state === "sleep" && s.breaksOnDamage && s.until > t + 0.1) s.until = t + 0.1;
      }

      // Movimento.
      if (pulling) {
        const k = Math.min(1, (t + DT - e.pull!.start) / (e.pull!.end - e.pull!.start));
        const px = e.pull!.from.x + (e.pull!.to.x - e.pull!.from.x) * k;
        const py = e.pull!.from.y + (e.pull!.to.y - e.pull!.from.y) * k;
        e.pos.x = px;
        e.pos.y = py;
        continue;
      }
      // O sono encurtado acima continua ativo neste passo (vai até t + 0,1).
      if (hardActive) continue;
      let dir: Point | null = null;
      if (e.fleeFrom && t >= e.fleeAt) dir = norm({ x: e.pos.x - e.fleeFrom.x || 0.01, y: e.pos.y - e.fleeFrom.y });
      else if (scenario.behavior === "flee") dir = { x: 1, y: 0 };
      else if (scenario.behavior === "dive" && dist(e.pos, casterPos) > 3) dir = norm({ x: casterPos.x - e.pos.x, y: casterPos.y - e.pos.y });
      if (!dir) continue;
      if (e.fleeFrom && t >= e.fleeAt && scenario.canDash && !e.dashed && !silenced) {
        e.dashed = true;
        let reduction = 0;
        for (const s of e.statuses) if (s.until > t && s.dashReduction) reduction = Math.max(reduction, s.dashReduction);
        e.dashUntil = t + DASH_TIME * (1 - reduction / 100);
        e.dashDir = dir;
      }
      const dashing = t < e.dashUntil;
      const speed = dashing ? DASH_DISTANCE / DASH_TIME : ENEMY_SPEED * (1 - slow / 100);
      const d = dashing ? e.dashDir! : dir;
      const nx = e.pos.x + d.x * speed * DT;
      const ny = e.pos.y + d.y * speed * DT;
      e.pos.x = nx;
      e.pos.y = ny;
    }
  }

  return result(
    enemies.map((e) => e.out),
    hits,
    escaped,
    alive,
    cast,
    log,
  );
}
