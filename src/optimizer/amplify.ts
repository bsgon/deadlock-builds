/**
 * Vulnerabilidade: efeitos que fazem o alvo receber mais dano (amplificação).
 *
 * Fontes conferidas na deadlock.wiki; os valores vêm da API do patch atual (a wiki
 * às vezes está atrás, ex.: Napalm 16% na base, Malice 3 s de cooldown):
 *  - Malice (Lady Geist): cada fragmento aplica 1 acúmulo; o alvo recebe mais dano DE VOCÊ.
 *  - Napalm (Infernus): o alvo recebe mais dano de quem lançou.
 *  - Pulse Grenade (Paradox): cada pulso aplica 1 acúmulo de dano a mais de Paradox.
 *  - Rabbit Hex (Sinclair): o coelho recebe mais dano de todos (aqui conta só o seu).
 *  - Blasted (Billy): balas amplificadas contra alvos "wrecked" (atingidos por melee).
 *  - Hex-Lined Snap Trap (Venator, T3): mais dano de quem armou, depois de o alvo pisar.
 *  - Escalating Exposure (item): dano spirit acumula Spirit Amp no alvo (instância separada).
 *
 * Amplificações somam entre si (são % do mesmo dano base) e entram depois da
 * resistência. O valor é a média numa luta de `fight` segundos que começa com tudo
 * pronto, com o alvo sempre acertado (mesma premissa do dano de habilidade).
 */
import type { BuildResult } from "../engine/index.ts";

export type AmpKind = "all" | "bullet" | "spirit";

export interface AmpSource {
  name: string;
  kind: AmpKind;
  /** Amplificação média na luta, em %. */
  averagePct: number;
  /** Amplificação no pico (acúmulos cheios), em %. */
  peakPct: number;
}

export interface Amplification {
  /** Multiplicadores médios do seu dano, por tipo (1 = sem amplificação). */
  bullet: number;
  spirit: number;
  sources: AmpSource[];
}

const STEP = 0.1;

/** Momentos dos usos na luta: cargas saem no intervalo entre cargas, depois a cada cooldown. */
function castTimes(cooldown: number, fight: number, charges = 1, betweenCharges = 0, delay = 0): number[] {
  const out: number[] = [];
  const between = Math.max(betweenCharges, 0.5);
  for (let c = 0; c < Math.max(1, charges); c++) {
    for (let t = delay + c * between; t < fight; t += Math.max(1, cooldown)) out.push(t);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Média, na luta, de um debuff que acumula `stacksPerUse` por uso (até `maxStacks`),
 * dura `duration` desde o último uso e vale `pctPerStack` por acúmulo.
 */
export function stackingAverage(uses: number[], stacksPerUse: number, maxStacks: number, duration: number, pctPerStack: number, fight: number): { average: number; peak: number } {
  let sum = 0;
  let peak = 0;
  let stacks = 0;
  let last = -Infinity;
  let next = 0;
  const steps = Math.round(fight / STEP);
  for (let i = 0; i < steps; i++) {
    const t = i * STEP;
    while (next < uses.length && uses[next]! <= t + 1e-9) {
      stacks = t - last > duration ? 0 : stacks;
      stacks = Math.min(maxStacks, stacks + stacksPerUse);
      last = uses[next]!;
      next++;
    }
    const active = t - last <= duration ? stacks : 0;
    sum += active * pctPerStack;
    peak = Math.max(peak, active * pctPerStack);
  }
  return { average: sum / steps, peak };
}

const v = (props: Record<string, { value: number }>, key: string) => props[key]?.value ?? 0;

export function amplification(build: BuildResult, fight: number, uptime: number): Amplification {
  const sources: AmpSource[] = [];
  const add = (name: string, kind: AmpKind, r: { average: number; peak: number }) => {
    if (r.peak > 0) sources.push({ name, kind, averagePct: r.average, peakPct: r.peak });
  };

  for (const a of build.abilities) {
    if (a.slot > build.progression.abilityUnlocks) continue;
    const p = a.properties;
    const cooldown = v(p, "AbilityCooldown");
    if (cooldown <= 0) continue;
    const uses = castTimes(cooldown, fight, v(p, "AbilityCharges") || 1, v(p, "AbilityCooldownBetweenCharge"), v(p, "AbilityCastDelay"));
    if (v(p, "VulnerabilityPerStack") > 0) {
      // Malice: um acúmulo por fragmento que acerta.
      add(a.name, "all", stackingAverage(uses, v(p, "NumBloodShards") || 1, v(p, "MaxStacks") || 1, v(p, "DebuffDuration") || 6, v(p, "VulnerabilityPerStack"), fight));
    } else if (v(p, "DamageAmplificationPerStack") > 0) {
      // Pulse Grenade: um acúmulo por pulso; o debuff dura desde o último pulso.
      const pulses = Math.max(1, Math.floor(v(p, "AbilityDuration") / Math.max(0.1, v(p, "PulseInterval"))) + 1);
      const interval = v(p, "PulseInterval") || 0.8;
      const pulseTimes = uses.flatMap((u) => Array.from({ length: pulses }, (_, k) => u + k * interval)).filter((t) => t < fight);
      add(a.name, "all", stackingAverage(pulseTimes, 1, pulses, v(p, "DebuffDuration") || 8, v(p, "DamageAmplificationPerStack"), fight));
    } else if (v(p, "DamageAmpPercentage") > 0 && v(p, "HexDuration") > 0) {
      add(a.name, "all", stackingAverage(uses, 1, 1, v(p, "HexDuration"), v(p, "DamageAmpPercentage"), fight));
    } else if (v(p, "BulletDamageAmp") > 0) {
      // Blasted: só contra alvo "wrecked" (melee), dentro da duração do ativo.
      const r = stackingAverage(uses, 1, 1, Math.min(v(p, "AbilityDuration") || 8, v(p, "BulletDamageAmpDuration") || 7), v(p, "BulletDamageAmp"), fight);
      const melee = Math.max(build.meleeShare, 0.5);
      add(a.name, "bullet", { average: r.average * melee, peak: r.peak });
    } else if (v(p, "IncomingDamagePercentFromCaster") > 0) {
      // Napalm: dura o debuff. Armadilha: só depois de o alvo pisar (metade das vezes).
      const isTrap = v(p, "ArmTime") > 0;
      const duration = isTrap ? v(p, "RevealDuration") || 4 : v(p, "DebuffDuration") || 6;
      const r = stackingAverage(uses, 1, 1, duration, v(p, "IncomingDamagePercentFromCaster"), fight);
      add(a.name, "all", isTrap ? { average: r.average * 0.5, peak: r.peak } : r);
    }
  }

  for (const item of build.items) {
    const p = item.properties;
    const perStack = v(p, "MagicIncreasePerStack");
    if (perStack <= 0) continue;
    // Escalating Exposure: um acúmulo a cada dano spirit (no máximo um por ProcCooldown),
    // com dano spirit saindo pela fração do tempo em que as habilidades e itens acertam.
    const every = Math.max(0.1, v(p, "ProcCooldown") || 0.7) / Math.max(0.1, uptime);
    const ticks: number[] = [];
    for (let t = 0; t < fight; t += every) ticks.push(t);
    add(item.name, "spirit", stackingAverage(ticks, 1, v(p, "MaxStacks") || 1, v(p, "AbilityDuration") || 12, perStack, fight));
  }

  const sum = (kind: AmpKind) => sources.filter((s) => s.kind === kind || s.kind === "all").reduce((t, s) => t + s.averagePct, 0) / 100;
  return { bullet: 1 + sum("bullet"), spirit: 1 + sum("spirit"), sources };
}
