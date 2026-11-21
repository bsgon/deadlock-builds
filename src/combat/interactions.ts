/**
 * Famílias de interação descritas por efeitos, sem pares de nomes: uma ação cria
 * ou muda um estado do combate e a próxima se beneficia (ou é prejudicada).
 * A detecção só aponta a pergunta; quem mede é a simulação (`value.ts`) ou as
 * contas abaixo (ativações por acerto, ciclo do combo).
 */
import { tr } from "../i18n.ts";
import type { EffectDef, EffectState } from "./effects.ts";

export type Family =
  | "grouping" // agrupamento + habilidade em área
  | "restraintDelayed" // restrição de movimento + detonação atrasada
  | "zoneDot" // permanência em zona + dano contínuo
  | "onHit" // ataques frequentes + efeito por acerto
  | "shredDamage" // redução de resistência + dano
  | "defenseExposure" // defesa + habilidade que exige exposição
  | "cooldownCombo"; // redução de cooldown + combo

// Rótulos como getters: o idioma só é definido depois de o módulo carregar.
export const FAMILY_LABEL: Record<Family, string> = {
  get grouping() {
    return tr("agrupar alvos para uma área", "group targets for an area");
  },
  get restraintDelayed() {
    return tr("prender o alvo até a detonação", "hold the target until the detonation");
  },
  get zoneDot() {
    return tr("manter o alvo no dano contínuo", "keep the target in the damage over time");
  },
  get onHit() {
    return tr("acertos frequentes ativando efeito por acerto", "frequent hits triggering on-hit effects");
  },
  get shredDamage() {
    return tr("reduzir resistência antes do dano", "reduce resistance before the damage");
  },
  get defenseExposure() {
    return tr("sobreviver para concluir a jogada", "survive to finish the play");
  },
  get cooldownCombo() {
    return tr("combo volta mais cedo", "combo comes back sooner");
  },
};

export const FAMILY_QUESTION: Record<Family, string> = {
  get grouping() {
    return tr("Quantos alvos a mais estão dentro da área no instante do impacto?", "How many more targets are inside the area at the moment of impact?");
  },
  get restraintDelayed() {
    return tr("O alvo que escaparia continua dentro quando a habilidade resolve?", "Is the target that would escape still inside when the ability resolves?");
  },
  get zoneDot() {
    return tr("Quantos ticks a mais atingem o alvo antes de ele sair, dissipar ou morrer?", "How many more ticks hit the target before it leaves, cleanses or dies?");
  },
  get onHit() {
    return tr("Quantas ativações elegíveis ocorrem, com cooldown interno, limite de acúmulo e duração da luta?", "How many eligible procs happen, given internal cooldown, stack limit and fight length?");
  },
  get shredDamage() {
    return tr("Quanto dano do tipo certo entra na janela da redução?", "How much damage of the right type lands within the reduction window?");
  },
  get defenseExposure() {
    return tr("A proteção cobre a ameaça que impedia a execução? Quanto da jogada o herói conclui?", "Does the protection cover the threat that prevented the play? How much of the play does the hero finish?");
  },
  get cooldownCombo() {
    return tr("A sequência inteira volta mais cedo ou outra peça continua limitando?", "Does the whole sequence come back sooner, or does another piece still limit it?");
  },
};

const RESTRAINT: EffectState[] = ["pull", "immobilize", "stun", "sleep", "slow", "movementSilence"];
const HARD: EffectState[] = ["pull", "immobilize", "stun", "sleep"];

export interface InteractionCandidate {
  family: Family;
  setup: EffectDef | null;
  payoff: EffectDef;
  question: string;
  /** Interação que pode atrapalhar (deslocamento tira da zona, controle sobreposto). */
  risk?: string;
}

const isArea = (e: EffectDef) => (e.geometry.radius ?? 0) > 0 || (e.geometry.length ?? 0) > 0;
const isDelayed = (e: EffectDef) => e.trigger === "resolve" && e.timing.resolveDelay > 0 && e.counters.includes("leaveArea");
const offensive = (e: EffectDef) => e.target === "enemy" || e.target === "enemies";

/**
 * Pares preparo → aproveitamento entre efeitos de fontes diferentes, pelas regras
 * das famílias. `exposure` = a build tem ações que exigem o herói vivo e perto.
 */
export function discoverInteractions(effects: EffectDef[], opts: { defenseGain?: boolean } = {}): InteractionCandidate[] {
  const out: InteractionCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: InteractionCandidate) => {
    const key = `${c.family}|${c.setup?.source.className ?? "-"}|${c.payoff.source.className}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  for (const setup of effects.filter(offensive)) {
    for (const payoff of effects.filter(offensive)) {
      if (setup.source.className === payoff.source.className) continue;
      if (setup.state === "pull" && isArea(payoff) && ["damage", "immobilize", "stun", "dot"].includes(payoff.state))
        push({ family: "grouping", setup, payoff, question: FAMILY_QUESTION.grouping, risk: payoff.state === "dot" ? tr("Puxar depois de lançar a área tira os alvos do dano contínuo.", "Pulling after casting the area takes the targets out of the damage over time.") : undefined });
      if (RESTRAINT.includes(setup.state) && isDelayed(payoff)) push({ family: "restraintDelayed", setup, payoff, question: FAMILY_QUESTION.restraintDelayed });
      if (RESTRAINT.includes(setup.state) && payoff.state === "dot" && isArea(payoff)) push({ family: "zoneDot", setup, payoff, question: FAMILY_QUESTION.zoneDot });
      if (setup.state === "resistShred" && (payoff.state === "damage" || payoff.state === "dot") && payoff.damageType === setup.damageType)
        push({ family: "shredDamage", setup, payoff, question: FAMILY_QUESTION.shredDamage });
      if (HARD.includes(setup.state) && HARD.includes(payoff.state) && setup.state !== "pull")
        push({ family: "restraintDelayed", setup, payoff, question: tr("Controle sobreposto: quanto tempo ou quantas ações a mais ele afeta?", "Overlapping control: how much extra time or how many extra actions does it affect?"), risk: tr("Dois controles ao mesmo tempo impedem a mesma ação: só conta o tempo a mais.", "Two controls at once block the same action: only the extra time counts.") });
    }
  }
  for (const payoff of effects.filter((e) => e.trigger === "bulletHit" || e.trigger === "spiritDamage"))
    if ((payoff.rules.internalCooldown ?? payoff.timing.cooldown) > 0) push({ family: "onHit", setup: null, payoff, question: FAMILY_QUESTION.onHit });
  if (opts.defenseGain)
    for (const payoff of effects.filter((e) => offensive(e) && e.source.kind === "ability" && e.timing.cooldown > 0 && (isDelayed(e) || e.origin === "caster")))
      push({ family: "defenseExposure", setup: null, payoff, question: FAMILY_QUESTION.defenseExposure });
  const cdr = effects.find((e) => e.state === "cooldownReduction");
  if (cdr) for (const payoff of effects.filter((e) => offensive(e) && e.timing.cooldown > 0)) push({ family: "cooldownCombo", setup: cdr, payoff, question: FAMILY_QUESTION.cooldownCombo });
  return out;
}

/** Ordem de preferência quando um efeito participa de mais de uma família. */
const PRIORITY: Family[] = ["grouping", "restraintDelayed", "zoneDot", "shredDamage", "defenseExposure", "cooldownCombo", "onHit"];

/**
 * Família que melhor descreve o papel de uma fonte: prefere pares cujo outro lado
 * está na jogada usada (`used`) e, entre eles, a família mais específica.
 */
export function familyFor(candidates: InteractionCandidate[], source: string, used: Set<string> = new Set(), effectId?: string): Family | null {
  const mine = candidates.filter((c) => (effectId ? c.setup?.id === effectId : c.setup?.source.className === source || c.payoff.source.className === source));
  const other = (c: InteractionCandidate) => (c.setup?.source.className === source ? c.payoff.source.className : c.setup?.source.className);
  const inPlay = mine.filter((c) => used.has(other(c) ?? ""));
  const list = inPlay.length ? inPlay : mine;
  list.sort((a, b) => PRIORITY.indexOf(a.family) - PRIORITY.indexOf(b.family));
  return list[0]?.family ?? null;
}

/**
 * Ativações de um efeito por acerto numa luta: limitadas pelos acertos, pelo
 * cooldown interno e pelo limite de acúmulo (quando o efeito acumula).
 */
export function onHitActivations(opts: { hitsPerSecond: number; fightSeconds: number; internalCooldown: number; cap?: number | null }): number {
  const hits = opts.hitsPerSecond * opts.fightSeconds;
  const byCooldown = opts.internalCooldown > 0 ? Math.floor(opts.fightSeconds / opts.internalCooldown) + 1 : Infinity;
  return Math.min(hits, byCooldown, opts.cap ?? Infinity);
}

/**
 * Ciclo de um combo: volta quando a peça mais lenta volta. Redução de cooldown
 * de habilidades não vale para itens ativos (e vice-versa).
 */
export function comboCycle(pieces: { cooldown: number; kind: "ability" | "item" }[], cdr: { ability: number; item: number }): { cycle: number; limiter: number } {
  let cycle = 0;
  let limiter = -1;
  pieces.forEach((p, i) => {
    const cd = p.cooldown * (1 - (p.kind === "ability" ? cdr.ability : cdr.item) / 100);
    if (cd > cycle) [cycle, limiter] = [cd, i];
  });
  return { cycle, limiter };
}
