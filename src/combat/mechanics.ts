/**
 * Definições revisadas de mecânicas que a API não descreve por propriedades.
 *
 * Cada revisão diz a fonte, o patch em que foi conferida e de quais
 * propriedades do snapshot depende (`dependsOn`, com o valor da época). Quando
 * o patch muda e alguma delas muda de valor, `reviewStatus` marca a revisão como
 * desatualizada, e as recomendações que usam esses efeitos saem com confiança
 * menor até alguém revisar de novo.
 */
import type { GameData } from "../data/types.ts";
import { tr } from "../i18n.ts";
import type { EffectDef, EffectState, Scale } from "./effects.ts";

type Patch = {
  trigger?: EffectDef["trigger"];
  origin?: EffectDef["origin"];
  target?: EffectDef["target"];
  conditions?: string[];
  geometry?: Partial<EffectDef["geometry"]>;
  timing?: Partial<EffectDef["timing"]>;
  rules?: Partial<EffectDef["rules"]>;
  counters?: EffectDef["counters"];
};

export interface MechanicReview {
  source: string;
  name: string;
  patch: number;
  /** Propriedades (valor base) que sustentam a revisão. */
  dependsOn: Record<string, number>;
  /** Ajuste por estado ("*" = todos os efeitos da fonte). */
  set: Partial<Record<EffectState | "*", Patch>>;
  /** Efeitos que o importador não gera. */
  add?: { state: EffectState; magnitude: number; patch: Patch }[];
  /** Campos que esta revisão resolve (saem de `unknown`). */
  resolves: string[];
  /** Campos ainda sem fonte (entram em `unknown`). */
  stillUnknown: string[];
  evidence: string;
  url?: string;
}

const WIKI = "https://deadlock.wiki/";

export const REVIEWS: MechanicReview[] = [
  {
    source: "ability_bookworm_aoemagic",
    name: "Captivating Read",
    patch: 6861,
    dependsOn: { Radius: 7.5, ImmobilizeDuration: 1, SlowDuration: 0.5, SlowPercent: 36, Damage: 90, AbilityCastDelay: 0.15 },
    set: {
      "*": { origin: "point", target: "enemies", timing: { resolveDelay: 1.25 }, counters: ["leaveArea", "dash", "dispel", "unstoppable", "debuffResist"] },
      // A lentidão vem com a marca da área, antes da detonação; tratada como renovada enquanto o alvo está dentro.
      slow: { trigger: "landing", timing: { resolveDelay: 0 }, rules: { stacking: "refresh" } },
      damage: { trigger: "resolve" },
      immobilize: { trigger: "resolve" },
    },
    resolves: ["timing.resolveDelay"],
    stillUnknown: ["geometry.los", "rules.stacking (lentidão renovada dentro da área)"],
    evidence: "Wiki (Paige › Captivating Read, notas): 'The detonation happens 1.25s after cast'; efeito dissipável, bloqueado por Unstoppable.",
    url: `${WIKI}Paige`,
  },
  {
    source: "upgrade_aoe_root",
    name: "Vortex Web",
    patch: 6861,
    dependsOn: { CaptureRadius: 12, TetherDuration: 0.5, SlowPercent: 28, AbilityDuration: 4, GroundDashReductionPercent: -36, AbilityCastDelay: 0.2 },
    set: {
      "*": { origin: "point", target: "enemies", trigger: "landing", geometry: { speed: 32 }, counters: ["dispel", "unstoppable", "debuffResist"] },
      pull: { timing: { duration: 0.5 }, rules: { pullTo: 1.5 } },
      slow: { timing: { duration: 4 } },
      movementSilence: { timing: { duration: 4 } },
    },
    add: [
      { state: "immobilize", magnitude: 1, patch: { origin: "point", target: "enemies", trigger: "landing", geometry: { speed: 32 }, timing: { duration: 0.5 }, counters: ["dispel", "unstoppable", "debuffResist"] } },
      // "applying Slowing Hex": o Slowing Hex silencia itens e habilidades de movimento (sem dash).
      { state: "movementSilence", magnitude: 1, patch: { origin: "point", target: "enemies", trigger: "landing", geometry: { speed: 32 }, timing: { duration: 4 }, counters: ["dispel", "unstoppable", "debuffResist"] } },
    ],
    resolves: ["timing.duration", "geometry.speed", "rules.pullTo"],
    stillUnknown: ["rules.pullTo (raio final do agrupamento: 'small area')"],
    evidence: "Wiki (Vortex Web): puxa todos os inimigos no raio de captura de 12 m com 0,5 s de imobilização e aplica Slowing Hex; projétil a ~32 m/s.",
    url: `${WIKI}Vortex_Web`,
  },
  {
    source: "upgrade_containment",
    name: "Slowing Hex",
    patch: 6861,
    dependsOn: { SlowPercent: 16, AbilityDuration: 3.5, AbilityCastRange: 25 },
    set: { "*": { origin: "target", target: "enemy", trigger: "landing" } },
    resolves: [],
    stillUnknown: ["geometry.speed"],
    evidence: "Texto do item: 'Slows movement of enemy target. Also Silences their movement-based items and abilities.'",
  },
  {
    source: "ability_bookworm_dragonfire",
    name: "Bookwyrm",
    patch: 6861,
    dependsOn: { Radius: 4, GroundFlameDuration: 3, DragonTravelRange: 20, DPS: 30, Damage: 60 },
    set: {
      "*": { origin: "point", target: "enemies", trigger: "landing", geometry: { length: 20, width: 3, speed: 20 } },
      dot: { timing: { tickInterval: 0.3 } },
    },
    resolves: ["timing.tickInterval"],
    stillUnknown: ["geometry.width (rastro um pouco mais estreito que o raio inicial)", "geometry.speed (velocidade do dragão)"],
    evidence: "Wiki (Paige › Bookwyrm, notas): dano em intervalos de 0,3 s; o raio inicial é um pouco maior que a largura do rastro.",
    url: `${WIKI}Paige`,
  },
  {
    source: "upgrade_target_stun",
    name: "Knockdown",
    patch: 6861,
    dependsOn: { StunDelay: 2, StunDuration: 0.5 },
    set: { "*": { origin: "target", target: "enemy", counters: ["dispel", "unstoppable", "debuffResist"] } },
    resolves: [],
    stillUnknown: [],
    evidence: "Texto do item: 'Apply a Stun after 2s' (o efeito acompanha o alvo; sair da área não resolve).",
  },
  {
    source: "ability_fire_bomb",
    name: "Concussive Combustion",
    patch: 6861,
    dependsOn: { ExplodeDelay: 3.25, Radius: 12, StunDuration: 1.25 },
    set: { "*": { origin: "caster", target: "enemies", trigger: "resolve", counters: ["leaveArea", "dash", "dispel", "unstoppable", "debuffResist"] } },
    resolves: [],
    stillUnknown: [],
    evidence: "Texto da habilidade: 'dealing spirit damage and applying stun to all nearby enemies after a delay. Once cast, Concussive Combustion cannot be interrupted.'",
  },
];

/** Campos revisados que escalam com alcance e duração da build. */
function scaled(patch: Patch, scale?: Scale): Patch {
  if (!scale) return patch;
  const g = patch.geometry ? { ...patch.geometry } : undefined;
  if (g) for (const k of ["length", "width"] as const) if (typeof g[k] === "number") g[k] = g[k]! * scale.range;
  const t = patch.timing ? { ...patch.timing } : undefined;
  if (t && typeof t.duration === "number") t.duration = t.duration * scale.duration;
  return { ...patch, ...(g ? { geometry: g } : {}), ...(t ? { timing: t } : {}) };
}

function merge(e: EffectDef, patch: Patch): EffectDef {
  return {
    ...e,
    ...(patch.trigger ? { trigger: patch.trigger } : {}),
    ...(patch.origin ? { origin: patch.origin } : {}),
    ...(patch.target ? { target: patch.target } : {}),
    ...(patch.conditions ? { conditions: patch.conditions } : {}),
    ...(patch.counters ? { counters: patch.counters } : {}),
    geometry: { ...e.geometry, ...patch.geometry },
    timing: { ...e.timing, ...patch.timing },
    rules: { ...e.rules, ...patch.rules },
  };
}

/** Campos ainda sem fonte (`stillUnknown`) em inglês; aparecem nas incertezas da recomendação. */
const UNKNOWN_EN: Record<string, string> = {
  "rules.stacking (lentidão renovada dentro da área)": "rules.stacking (slow refreshed while inside the area)",
  "rules.pullTo (raio final do agrupamento: 'small area')": "rules.pullTo (final grouping radius: 'small area')",
  "geometry.width (rastro um pouco mais estreito que o raio inicial)": "geometry.width (trail slightly narrower than the initial radius)",
  "geometry.speed (velocidade do dragão)": "geometry.speed (dragon speed)",
};

/** Aplica as revisões da fonte aos efeitos importados. */
export function applyReviews(effects: EffectDef[], className: string, scale?: Scale): EffectDef[] {
  const review = REVIEWS.find((r) => r.source === className);
  if (!review) return effects;
  let out = effects.map((e) => {
    let next = e;
    if (review.set["*"]) next = merge(next, scaled(review.set["*"], scale));
    const own = review.set[e.state];
    if (own) next = merge(next, scaled(own, scale));
    return next;
  });
  for (const add of review.add ?? []) {
    if (out.some((e) => e.state === add.state)) continue;
    const template = out[0];
    if (!template) continue;
    out.push(merge({ ...template, id: `${className}:${add.state}`, state: add.state, magnitude: add.magnitude, rules: { ...template.rules } }, scaled(add.patch, scale)));
  }
  out = out.map((e) => ({
    ...e,
    provenance: {
      ...e.provenance,
      origin: review.url ? "wiki" : "review",
      unknown: [...e.provenance.unknown.filter((u) => !review.resolves.includes(u)), ...review.stillUnknown.map((u) => tr(u, UNKNOWN_EN[u] ?? u))],
      note: review.evidence,
      ...(review.url ? { url: review.url } : {}),
    },
  }));
  return out;
}

export interface ReviewStatus {
  review: MechanicReview;
  /** Propriedades que mudaram desde a revisão. */
  changed: { key: string; reviewed: number; now: number | null }[];
  /** Patch do snapshot é outro (a revisão pode continuar valendo). */
  patchDiffers: boolean;
  stale: boolean;
}

/** Revisões afetadas por mudança de patch: valores de que dependem mudaram. */
export function reviewStatus(data: GameData): ReviewStatus[] {
  const props = (cls: string) => data.abilities.find((a) => a.className === cls)?.properties ?? data.items.find((i) => i.className === cls)?.properties ?? null;
  return REVIEWS.map((review) => {
    const p = props(review.source);
    const changed = Object.entries(review.dependsOn)
      .map(([key, reviewed]) => ({ key, reviewed, now: p?.[key]?.value ?? null }))
      .filter((c) => c.now !== c.reviewed);
    return { review, changed, patchDiffers: data.meta.clientVersion !== review.patch, stale: p === null || changed.length > 0 };
  });
}

/** Fontes (className) cujas revisões estão desatualizadas no snapshot. */
export function staleSources(data: GameData): Set<string> {
  return new Set(reviewStatus(data).filter((s) => s.stale).map((s) => s.review.source));
}
