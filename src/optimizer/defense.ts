/**
 * Defesa além de vida e resistência: o que faz itens de vitality de tier 3-4
 * (Unstoppable, Ethereal Shift, Cheat Death, barreiras...) valerem no fim de jogo.
 *
 * O modelo pensa em lutas: uma luta dura ~20 s e acontece a cada ~60 s, então um
 * ativo com cooldown até 60 s sai uma vez por luta. Cada efeito vira vida efetiva:
 *  - barreira: soma vida (uma vez por luta);
 *  - tempo sem levar dano (invulnerável, imune a balas, imune à morte): estende a luta;
 *  - proteção contra controle (resistência a status, imunidade, limpar debuffs): quem
 *    é stunado morre mais rápido, então proteção vale vida;
 *  - desvio de balas (Plated Armor): reduz o dano de arma recebido.
 * Os pesos são escolhas do projeto, para comparar builds; não são números do jogo.
 */
import type { Item } from "../data/types.ts";
import { resolveProperties, type BuildResult, type ResolvedProperty } from "../engine/index.ts";

/** Duração de uma luta e intervalo entre lutas, em segundos. */
export const FIGHT_SECONDS = 20;
const FIGHT_EVERY = 60;
/** Quanto vale estar 100% protegido de controle, em vida efetiva extra. */
const CC_VALUE = 0.35;
/** Proteção de um ativo que limpa debuffs, por uso. */
const CLEANSE = 0.15;

export interface DefenseSource {
  name: string;
  kind: "barrier" | "time" | "cc" | "deflect";
  /** Barreira em vida; tempo e controle em fração (0,2 = 20%). */
  value: number;
}

export interface Defense {
  /** Barreira média por luta, em vida. */
  barrier: number;
  /** Fração extra de luta sem levar dano (0,25 = a luta dura 25% a mais). */
  time: number;
  /** Proteção contra controle, 0 a 1. */
  cc: number;
  /** Fração do dano de arma desviada. */
  deflect: number;
  sources: DefenseSource[];
}

const M = "MODIFIER_VALUE_";
/** Fração das lutas em que um efeito com esse cooldown está disponível. */
const perFight = (cooldown: number) => (cooldown > 0 ? Math.min(1, FIGHT_EVERY / cooldown) : 1);

function itemDefense(item: Item, build: BuildResult): DefenseSource[] {
  const p: Record<string, ResolvedProperty> = resolveProperties(item.properties, [], build.stats, build.progression.boons);
  const v = (k: string) => Math.abs(p[k]?.value ?? 0);
  const text = item.sections.map((s) => s.text).join(" ");
  const avail = perFight(v("AbilityCooldown"));
  const out: DefenseSource[] = [];

  const barrier = Object.entries(item.properties)
    .filter(([, prop]) => prop.provides === `${M}BARRIER_HEALTH`)
    .reduce((sum, [k]) => sum + v(k), 0);
  if (barrier > 0) out.push({ name: item.name, kind: "barrier", value: barrier * avail });

  // Segundos sem levar dano por luta.
  let seconds = 0;
  if (/invulnerab/i.test(text)) seconds += v("AbilityDuration");
  if (/immune to bullets/i.test(text)) seconds += v("AbilityDuration") * 0.5; // balas ~ metade do dano
  seconds += v("DeathImmunityDuration");
  if (seconds > 0) out.push({ name: item.name, kind: "time", value: (seconds * avail) / FIGHT_SECONDS });

  // Proteção contra controle: imunidade ativa e limpeza de debuffs (a resistência a status vem dos stats).
  let cc = 0;
  if (/immune to stun/i.test(text)) cc += Math.min(1, v("AbilityDuration") / FIGHT_SECONDS) * avail;
  if (/purge|remove all non-stun debuffs/i.test(text)) cc += CLEANSE * avail;
  if (cc > 0) out.push({ name: item.name, kind: "cc", value: Math.min(1, cc) });

  // Plated Armor: metade das vezes desvia a bala (sem dano), metade só anula efeitos de bala.
  if (v("DeflectionPercent") > 0) out.push({ name: item.name, kind: "deflect", value: (v("DeflectionPercent") / 100) * 0.5 });
  return out;
}

export function defenseOf(build: BuildResult): Defense {
  const sources = build.items.flatMap((i) => itemDefense(i, build));
  const status = (build.stats.itemTotals[`${M}STATUS_RESISTANCE`] ?? 0) / 100;
  if (status > 0) sources.push({ name: "Resistência a status", kind: "cc", value: status });
  const sum = (kind: DefenseSource["kind"]) => sources.filter((s) => s.kind === kind).reduce((t, s) => t + s.value, 0);
  // Proteções independentes se combinam: 1 - produto do que sobra.
  const cc = 1 - sources.filter((s) => s.kind === "cc").reduce((rest, s) => rest * (1 - Math.min(1, s.value)), 1);
  const deflect = 1 - sources.filter((s) => s.kind === "deflect").reduce((rest, s) => rest * (1 - s.value), 1);
  return { barrier: sum("barrier"), time: sum("time"), cc, deflect, sources };
}

/** Vida efetiva com a defesa por luta aplicada sobre vida e resistência. */
export function effectiveHealth(build: BuildResult, defense: Defense = defenseOf(build)): number {
  const { stats } = build;
  const bullet = stats.ehpBullet / Math.max(0.01, 1 - defense.deflect);
  const base = (bullet + stats.ehpSpirit) / 2;
  // Barreira é vida extra, protegida pelas mesmas resistências.
  const withBarrier = base + defense.barrier * (base / Math.max(1, stats.health));
  return withBarrier * (1 + defense.time) * (1 + CC_VALUE * defense.cc);
}
