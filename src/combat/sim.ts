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

/** Peso de cada controle no "controle útil": stun e sono tiram ações; imobilizado ainda atira e lança. */
export const CONTROL_WEIGHT: Partial<Record<EffectDef["state"], number>> = { stun: 1, sleep: 1, immobilize: 0.7, pull: 0.7, silence: 0.6, movementSilence: 0.2 };
const SLOW_WEIGHT = 0.5;
const HARD: EffectDef["state"][] = ["stun", "sleep", "immobilize", "pull"];
const ACTION_DENIAL: EffectDef["state"][] = ["stun", "sleep", "silence"];

type Status = { state: EffectDef["state"]; at: number; until: number; magnitude: number; source: string; cleansable: boolean; dashReduction?: number; breaksOnDamage?: boolean };
type Enemy = { pos: Point; statuses: Status[]; dashUntil: number; dashDir: Point | null; dashed: boolean; cleansed: boolean; fleeFrom: Point | null; fleeAt: number; out: EnemyOutcome; pull: { from: Point; to: Point; start: number; end: number } | null };
type Zone = { source: string; center: Point; radius: number; resolveAt: number; inside: Set<number>; aura: EffectDef[] };
type Trail = { source: string; from: Point; dir: Point; length: number; width: number; speed: number; start: number; end: number; dps: number; tick: number; nextTick: number; hitInitial: Set<number>; initial: number; initialRadius: number };
type Event = { t: number; run: () => void };

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const norm = (p: Point): Point => {
  const d = Math.hypot(p.x, p.y) || 1;
  return { x: p.x / d, y: p.y / d };
};

export function simulate(scenario: Scenario, actions: Action[], caster: Caster): SimResult {
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
    if (e) e.statuses.push({ state: scenario.allyHold.state, at: 0, until: scenario.allyHold.until, magnitude: 1, source: "aliado", cleansable: false });
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

  const has = (e: Enemy, t: number, states: EffectDef["state"][]) => e.statuses.some((s) => s.until > t && states.includes(s.state));
  const slowOf = (e: Enemy, t: number) => Math.max(0, ...e.statuses.filter((s) => s.until > t && s.state === "slow").map((s) => s.magnitude));
  const centroid = (): Point => {
    const n = enemies.length;
    return enemies.reduce((s, e) => ({ x: s.x + e.pos.x / n, y: s.y + e.pos.y / n }), { x: 0, y: 0 });
  };
  const shredOf = (e: Enemy, t: number) => Math.max(0, ...e.statuses.filter((s) => s.until > t && s.state === "resistShred").map((s) => s.magnitude));
  const hurt = (i: number, amount: number, t: number, source: string) => {
    const e = enemies[i]!;
    const dealt = amount * (1 + shredOf(e, t) / 100);
    e.out.damage += dealt;
    // Dano acorda quem dorme (Sleep Dagger): efeito negativo entre ações.
    for (const s of e.statuses) if (s.state === "sleep" && s.breaksOnDamage && s.until > t + 0.1 && s.source !== source) s.until = t + 0.1;
  };
  const apply = (i: number, eff: EffectDef, t: number, duration = eff.timing.duration) => {
    const e = enemies[i]!;
    if (eff.state === "damage") return hurt(i, eff.magnitude, t, eff.source.className);
    if (duration <= 0 && eff.state !== "pull") return;
    if (eff.state === "pull") return;
    const cleansable = (eff.counters as Counter[]).includes("dispel") && eff.state !== "stun" && eff.state !== "sleep";
    // Renovação: o mesmo efeito da mesma fonte só estende a duração.
    const same = e.statuses.find((s) => s.state === eff.state && s.source === eff.source.className && s.until >= t);
    if (same) {
      same.until = Math.max(same.until, t + duration);
      return;
    }
    e.statuses.push({ state: eff.state, at: t, until: t + duration, magnitude: eff.magnitude, source: eff.source.className, cleansable, ...(eff.rules.dashReduction ? { dashReduction: eff.rules.dashReduction } : {}), ...(eff.rules.breaksOnDamage ? { breaksOnDamage: true } : {}) });
  };
  const inArea = (center: Point, radius: number) => enemies.map((e, i) => (dist(e.pos, center) <= radius ? i : -1)).filter((i) => i >= 0);

  for (const action of actions) {
    const effects = action.effects;
    if (effects.length === 0) continue;
    const first = effects[0]!;
    const castEnd = Math.max(action.at, scenario.readyAt) + first.timing.castDelay;
    events.push({
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
        events.push({
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
                trails.push({ source: action.source, from, dir, length: len, width: eff.geometry.width ?? (eff.geometry.radius ?? 3) * 0.75, speed: eff.geometry.speed ?? 20, start: landing, end: landing + len / (eff.geometry.speed ?? 20) + eff.timing.duration, dps: eff.magnitude, tick: eff.timing.tickInterval ?? 0.5, nextTick: landing, hitInitial: new Set(), initial: dmg?.magnitude ?? 0, initialRadius: dmg?.geometry.radius ?? 4 });
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
              events.push({
                t: landing + resolveDelay,
                run: () => {
                  const delayed = effects.filter((e) => e.trigger === "resolve" || e.timing.resolveDelay > 0);
                  for (const eff of delayed) apply(0, eff, landing + resolveDelay);
                  hits[action.source] = (hits[action.source] ?? 0) + 1;
                },
              });
            }
            if (resolveDelay > 0 && !followTarget) {
              events.push({
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
  const horizon = Math.min(10, Math.max(lastAt, scenario.readyAt + 2));
  for (let t = 0; t <= horizon + 1e-9; t += DT) {
    // Herói sob iniciação: morre se o dano passar da vida efetiva antes de lançar.
    if (alive && t < scenario.incomingFor) {
      damageTaken += scenario.incomingDps * DT;
      if (damageTaken >= caster.ehp) {
        alive = false;
        log.push(`${t.toFixed(2)}s herói abatido antes de concluir a sequência`);
      }
    }
    events.sort((a, b) => a.t - b.t);
    while (events.length && events[0]!.t <= t + 1e-9) events.shift()!.run();

    // Área marcada com lentidão renovada enquanto o alvo está dentro (Captivating Read).
    for (const z of zones) for (const eff of z.aura) for (const i of inArea(z.center, z.radius)) apply(i, eff, t, Math.max(eff.timing.duration, DT));

    for (const tr of trails) {
      if (t < tr.start || t > tr.end) continue;
      const head = Math.min(tr.length, (t - tr.start) * tr.speed);
      enemies.forEach((e, i) => {
        const rel = { x: e.pos.x - tr.from.x, y: e.pos.y - tr.from.y };
        const along = rel.x * tr.dir.x + rel.y * tr.dir.y;
        const across = Math.abs(rel.x * -tr.dir.y + rel.y * tr.dir.x);
        if (!tr.hitInitial.has(i) && along >= 0 && along <= head && across <= tr.initialRadius) {
          tr.hitInitial.add(i);
          hurt(i, tr.initial, t, tr.source);
        }
      });
      if (t + 1e-9 >= tr.nextTick) {
        tr.nextTick += tr.tick;
        enemies.forEach((e, i) => {
          const rel = { x: e.pos.x - tr.from.x, y: e.pos.y - tr.from.y };
          const along = rel.x * tr.dir.x + rel.y * tr.dir.y;
          const across = Math.abs(rel.x * -tr.dir.y + rel.y * tr.dir.x);
          if (along >= 0 && along <= head && across <= tr.width) hurt(i, tr.dps * tr.tick, t, tr.source);
        });
      }
    }

    enemies.forEach((e, i) => {
      // Dissipar: o inimigo com o item tira imobilização e lentidão se ainda pode agir.
      // Stun, sono e silêncio impedem a resposta; imobilizado ainda usa o item.
      if (i < scenario.cleansers && !e.cleansed && !has(e, t, ACTION_DENIAL)) {
        const since = Math.min(...e.statuses.filter((s) => s.cleansable && s.until > t).map((s) => s.at));
        if (Number.isFinite(since) && t - since >= CLEANSE_DELAY) {
          for (const s of e.statuses) if (s.cleansable) s.until = Math.min(s.until, t);
          e.cleansed = true;
          log.push(`${t.toFixed(2)}s inimigo ${i + 1} dissipa os efeitos`);
        }
      }
      // Controle útil: o maior peso ativo no instante (controles sobrepostos não somam).
      const active = e.statuses.filter((s) => s.until > t);
      const pulling = e.pull && t >= e.pull.start && t < e.pull.end;
      let w = pulling ? CONTROL_WEIGHT.pull! : 0;
      for (const s of active) w = Math.max(w, s.state === "slow" ? (s.magnitude / 100) * SLOW_WEIGHT : (CONTROL_WEIGHT[s.state] ?? 0));
      const hard = pulling || active.some((s) => HARD.includes(s.state));
      const ours = active.some((s) => s.source !== "aliado") || pulling;
      if (ours) e.out.control += w * DT;
      if (hard && ours) {
        e.out.hard += DT;
        e.out.allyDamage += scenario.allyDps * DT;
        // Dano dos aliados acorda quem dorme (uma vez: o sono acaba logo depois).
        if (scenario.allyDps > 0) for (const s of e.statuses) if (s.state === "sleep" && s.breaksOnDamage && s.until > t + 0.1) s.until = t + 0.1;
      }

      // Movimento.
      if (pulling) {
        const k = Math.min(1, (t + DT - e.pull!.start) / (e.pull!.end - e.pull!.start));
        e.pos = { x: e.pull!.from.x + (e.pull!.to.x - e.pull!.from.x) * k, y: e.pull!.from.y + (e.pull!.to.y - e.pull!.from.y) * k };
        return;
      }
      if (has(e, t, HARD)) return;
      const slow = slowOf(e, t);
      let dir: Point | null = null;
      if (e.fleeFrom && t >= e.fleeAt) dir = norm({ x: e.pos.x - e.fleeFrom.x || 0.01, y: e.pos.y - e.fleeFrom.y });
      else if (scenario.behavior === "flee") dir = { x: 1, y: 0 };
      else if (scenario.behavior === "dive" && dist(e.pos, casterPos) > 3) dir = norm({ x: casterPos.x - e.pos.x, y: casterPos.y - e.pos.y });
      if (!dir) return;
      const silenced = has(e, t, ["movementSilence", "silence", "stun", "sleep"]);
      if (e.fleeFrom && t >= e.fleeAt && scenario.canDash && !e.dashed && !silenced) {
        e.dashed = true;
        const reduction = Math.max(0, ...e.statuses.filter((s) => s.until > t && s.dashReduction).map((s) => s.dashReduction!));
        e.dashUntil = t + DASH_TIME * (1 - reduction / 100);
        e.dashDir = dir;
      }
      const dashing = t < e.dashUntil;
      const speed = dashing ? DASH_DISTANCE / DASH_TIME : ENEMY_SPEED * (1 - slow / 100);
      const d = dashing ? e.dashDir! : dir;
      e.pos = { x: e.pos.x + d.x * speed * DT, y: e.pos.y + d.y * speed * DT };
    });
  }

  const sum = (k: keyof EnemyOutcome) => enemies.reduce((s, e) => s + e.out[k], 0);
  return {
    enemies: enemies.map((e) => e.out),
    hits,
    escaped,
    control: sum("control"),
    hard: sum("hard"),
    damage: sum("damage"),
    allyDamage: sum("allyDamage"),
    casterAlive: alive,
    cast,
    log,
  };
}
