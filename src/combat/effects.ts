/**
 * Modelo de efeitos de combate: cada habilidade ou item vira uma lista de
 * efeitos com gatilho, alvo, mudança de estado, geometria, tempo, regras de
 * cálculo e respostas do adversário.
 *
 * Os efeitos saem das propriedades estruturadas do snapshot (deadlock-api.com)
 * sempre que existem; o que a API não traz (atraso da detonação, puxão, largura
 * de rastro) vem das definições revisadas em `mechanics.ts`, cada uma com fonte e
 * patch. Campos que ninguém confirmou ficam listados em `provenance.unknown`.
 */
import type { GameData, Item } from "../data/types.ts";
import type { BuildResult, ResolvedProperty } from "../engine/index.ts";
import { resolveProperties } from "../engine/index.ts";
import { applyReviews } from "./mechanics.ts";

/** Mudança de estado no combate. */
export type EffectState =
  | "pull"
  | "slow"
  | "immobilize"
  | "stun"
  | "sleep"
  | "silence"
  | "movementSilence"
  | "damage"
  | "dot"
  | "heal"
  | "barrier"
  | "resistShred"
  | "cooldownReduction";

/** Momento em que o efeito acontece. */
export type Trigger =
  | "cast" // ao lançar (fim do tempo de lançamento)
  | "landing" // quando o projétil/área chega ao destino
  | "resolve" // depois do atraso de resolução (detonação)
  | "bulletHit"
  | "spiritDamage"
  | "heroHit"
  | "inCombat"
  | "whileBarrier"
  | "passive";

/** Respostas que o adversário ainda tem. */
export type Counter = "leaveArea" | "dash" | "interrupt" | "dispel" | "unstoppable" | "debuffResist" | "lineOfSight";

export interface EffectDef {
  id: string;
  source: { kind: "ability" | "item"; className: string; name: string; slot?: number };
  trigger: Trigger;
  /** Condições além do gatilho (ex.: "alvo herói", "barreira ativa"). */
  conditions: string[];
  /** De onde sai: o próprio herói, um ponto escolhido ou um alvo. */
  origin: "caster" | "point" | "target";
  /** Quem recebe. */
  target: "enemy" | "enemies" | "self" | "ally";
  state: EffectState;
  /** Dano, dano por segundo, % de lentidão, % de redução, barreira. */
  magnitude: number;
  damageType?: "spirit" | "bullet";
  geometry: {
    range: number | null;
    radius: number | null;
    /** Rastro em linha (Bookwyrm): comprimento e meia-largura. */
    length?: number | null;
    width?: number | null;
    /** Velocidade do projétil (m/s); null = instantâneo ou desconhecido. */
    speed: number | null;
    los: boolean | null;
  };
  timing: {
    castDelay: number;
    /** Atraso entre chegar e resolver (detonação). */
    resolveDelay: number;
    duration: number;
    tickInterval: number | null;
    charges: number;
    cooldown: number;
  };
  rules: {
    scaling: string | null;
    stacking: "refresh" | "stack" | "max" | "replace" | null;
    cap: number | null;
    internalCooldown: number | null;
    /** Pode ativar efeitos "ao causar dano" de itens. */
    procEligible: boolean | null;
    /** Puxão: distância final máxima do centro. */
    pullTo?: number;
    /** Redução da distância do dash do alvo (%). */
    dashReduction?: number;
    /** Sono acaba ao levar dano. */
    breaksOnDamage?: boolean;
  };
  counters: Counter[];
  provenance: { origin: "api" | "wiki" | "review"; patch: number; fields: string[]; unknown: string[]; note?: string; url?: string };
}

type Props = Record<string, { value: number; scale?: { fn?: string | null } | null } | ResolvedProperty>;

export interface EffectSource {
  kind: "ability" | "item";
  className: string;
  name: string;
  slot?: number;
  text: string;
  isActive: boolean;
  props: Props;
}

const v = (p: Props, ...keys: string[]): number => {
  for (const k of keys) {
    const x = p[k]?.value;
    if (x !== undefined && x !== 0 && x !== -1) return x;
  }
  return 0;
};

const scaleOf = (p: Props, key: string): string | null => {
  const s = (p[key] as { scale?: { fn?: string | null; stats?: string[] } | null } | undefined)?.scale;
  return s?.fn ? `${s.fn}${s.stats?.length ? `(${s.stats.join(",")})` : ""}` : null;
};

const DELAY_KEYS = ["ExplodeDelay", "ShockDelay", "StunDelay", "FuseTime", "ProjectileFuse"];
const RADIUS_KEYS = ["Radius", "ShockRadius", "CaptureRadius", "ExplosionRadius", "SilenceRadius", "FlameAuraRadius", "ChainRadius"];
const MENTIONS_DELAY = /after a (short )?delay|detonates after|after \d|after a short duration/i;

/**
 * Efeitos de uma fonte a partir das propriedades. Genérico: não olha nomes.
 * Mecânicas que a API não descreve são completadas por `applyReviews`.
 */
export function effectsFromSource(src: EffectSource, patch: number): EffectDef[] {
  const p = src.props;
  const text = src.text;
  const fields: string[] = [];
  const read = (...keys: string[]) => {
    for (const k of keys) if (p[k] && p[k]!.value !== 0 && p[k]!.value !== -1) fields.push(k);
    return v(p, ...keys);
  };
  const castDelay = read("AbilityCastDelay");
  const cooldown = read("AbilityCooldown");
  const charges = Math.max(1, read("AbilityCharges"));
  const range = read("AbilityCastRange") || null;
  const radius = read(...RADIUS_KEYS) || null;
  const resolveDelay = read(...DELAY_KEYS);
  const unknown: string[] = [];
  if (!resolveDelay && MENTIONS_DELAY.test(text)) unknown.push("timing.resolveDelay");
  const selfCentered = !range && !!radius && /nearby|around you|living bomb|all enemies near/i.test(text);
  const targeted = /target (enemy|unit|a target)|to a target|the target\b/i.test(text) && !radius;
  const origin: EffectDef["origin"] = selfCentered ? "caster" : targeted ? "target" : range || radius ? "point" : "caster";
  const area = !!radius;
  const delayed = resolveDelay > 0 || unknown.includes("timing.resolveDelay");
  const hitTrigger: Trigger = delayed ? "resolve" : src.isActive || src.kind === "ability" ? "landing" : "passive";
  const passiveTrigger: Trigger | null = /bullet|weapon hits|shooting|shot/i.test(text) ? "bulletHit" : /spirit damage/i.test(text) ? "spiritDamage" : null;
  const trigger = !src.isActive && src.kind === "item" ? (passiveTrigger ?? "passive") : hitTrigger;
  const counters = (state: EffectState): Counter[] => {
    const c: Counter[] = [];
    if (area && (delayed || state === "dot")) c.push("leaveArea", "dash");
    if (["stun", "immobilize", "sleep", "silence", "movementSilence", "slow"].includes(state)) c.push("dispel", "unstoppable", "debuffResist");
    if (/channel/i.test(text) && !/cannot be interrupted/i.test(text)) c.push("interrupt");
    return c;
  };
  const base = (state: EffectState, magnitude: number, extra: Partial<EffectDef> = {}): EffectDef => ({
    id: `${src.className}:${state}`,
    source: { kind: src.kind, className: src.className, name: src.name, ...(src.slot ? { slot: src.slot } : {}) },
    trigger,
    conditions: [],
    origin,
    target: area ? "enemies" : "enemy",
    state,
    magnitude,
    geometry: { range, radius, speed: null, los: null },
    timing: { castDelay, resolveDelay, duration: 0, tickInterval: null, charges, cooldown },
    rules: { scaling: null, stacking: null, cap: null, internalCooldown: read("ProcCooldown") || null, procEligible: null },
    counters: counters(state),
    provenance: { origin: "api", patch, fields: [...fields], unknown: [...unknown] },
    ...extra,
  });

  const out: EffectDef[] = [];
  const dmg = read("Damage", "DamagePerChain", "ProcBonusMagicDamage");
  if (dmg > 0 && (src.kind === "ability" || src.isActive || /damage/i.test(text))) {
    const e = base("damage", dmg, { damageType: /bullet damage/i.test(text) && !/spirit/i.test(text) ? "bullet" : "spirit" });
    e.rules.scaling = scaleOf(p, "Damage");
    out.push(e);
  }
  const dps = read("DPS");
  if (dps > 0) {
    const e = base("dot", dps, { damageType: "spirit" });
    e.timing.duration = read("GroundFlameDuration", "BurnDuration", "AbilityDuration", "DotDuration") || 3;
    e.timing.tickInterval = read("TickInterval") || null;
    if (!e.timing.tickInterval) e.provenance.unknown.push("timing.tickInterval");
    e.rules.scaling = scaleOf(p, "DPS");
    out.push(e);
  }
  const imm = read("ImmobilizeDuration");
  if (imm > 0) out.push({ ...base("immobilize", 1), timing: { ...base("immobilize", 1).timing, duration: imm } });
  const stun = read("StunDuration");
  if (stun > 0) out.push({ ...base("stun", 1), timing: { ...base("stun", 1).timing, duration: stun } });
  const sleep = read("SleepDuration");
  if (sleep > 0) {
    const e = base("sleep", 1);
    e.timing.duration = sleep;
    e.rules.breaksOnDamage = /wake up .*damaged|wakes? .*damage/i.test(text);
    out.push(e);
  }
  const silence = read("SilenceDuration");
  if (silence > 0) out.push({ ...base("silence", 1), timing: { ...base("silence", 1).timing, duration: silence } });
  const slow = read("SlowPercent");
  if (slow > 0) {
    const e = base("slow", slow);
    e.timing.duration = read("SlowDuration", "AbilityDuration", "DebuffDuration");
    const dash = -read("GroundDashReductionPercent");
    if (dash > 0) e.rules.dashReduction = dash;
    out.push(e);
  }
  if (/silences? (their |the target's )?movement/i.test(text)) {
    const e = base("movementSilence", 1);
    e.timing.duration = read("AbilityDuration", "DebuffDuration");
    out.push(e);
  }
  // Puxão que reposiciona inimigos (Vortex Web); "puxar para o chão" (Phantom Strike) e
  // puxar um aliado para perto (Rescue Beam) não agrupam ninguém.
  if (/\bpull/i.test(text) && !/pull[a-z]* (the target |them |the enemy )?(towards you|to the ground|down)/i.test(text)) {
    const e = base("pull", 1);
    e.timing.duration = read("TetherDuration");
    e.rules.pullTo = 1.5;
    e.provenance.unknown.push("rules.pullTo");
    if (!e.timing.duration) e.provenance.unknown.push("timing.duration");
    out.push(e);
  }
  const shred = -read("TechArmorDamageReduction");
  if (shred > 0 && (src.kind === "ability" || src.isActive || /resist reduced|reduce .*resist/i.test(text))) {
    const e = base("resistShred", shred, { damageType: "spirit" });
    e.timing.duration = read("DebuffDuration", "AbilityDuration") || 6;
    out.push(e);
  }
  const barrier = read("CombatBarrier");
  if (barrier > 0) {
    const e = base("barrier", barrier, { target: /ally/i.test(text) ? "ally" : "self", origin: "target" });
    e.timing.duration = read("AbilityDuration", "BuffDuration");
    out.push(e);
  }
  const cdr = read("CooldownReduction");
  if (cdr > 0 && !src.isActive) out.push({ ...base("cooldownReduction", cdr), trigger: "passive", target: "self", origin: "caster" });
  return out;
}

/** Fonte de efeito a partir de uma habilidade resolvida da build. */
export function abilitySource(a: BuildResult["abilities"][number]): EffectSource {
  return { kind: "ability", className: a.className, name: a.name, slot: a.slot, text: a.text, isActive: true, props: a.properties };
}

export function itemSource(item: Item, props: Props = item.properties): EffectSource {
  return { kind: "item", className: item.className, name: item.name, text: item.sections.map((s) => s.text).join(" "), isActive: item.isActive, props };
}

/**
 * Efeitos da build com os valores já escalados (poder spirit, duração, alcance).
 * Só habilidades desbloqueadas no nível entram.
 */
export function buildEffects(build: BuildResult, patch: number): EffectDef[] {
  const out: EffectDef[] = [];
  for (const a of build.abilities) if (a.slot <= build.progression.abilityUnlocks) out.push(...applyReviews(effectsFromSource(abilitySource(a), patch), a.className, scaleFor(build)));
  for (const item of build.items) {
    const props = resolveProperties(item.properties, [], build.stats, build.progression.boons);
    out.push(...applyReviews(effectsFromSource(itemSource(item, props), patch), item.className, scaleFor(build)));
  }
  return out;
}

/** Multiplicadores de alcance e duração da build, para escalar valores revisados. */
export interface Scale {
  range: number;
  duration: number;
}
const scaleFor = (build: BuildResult): Scale => ({ range: 1 + build.stats.rangePct / 100, duration: 1 + build.stats.durationPct / 100 });

/** Catálogo do patch: efeitos de todas as habilidades e itens com valores base. */
export function effectCatalog(data: GameData): EffectDef[] {
  const patch = data.meta.clientVersion;
  const out: EffectDef[] = [];
  for (const a of data.abilities) {
    out.push(...applyReviews(effectsFromSource({ kind: "ability", className: a.className, name: a.name, slot: a.slot, text: a.text, isActive: true, props: a.properties }, patch), a.className));
  }
  for (const item of data.items) out.push(...applyReviews(effectsFromSource(itemSource(item), patch), item.className));
  return out;
}
