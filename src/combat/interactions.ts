/**
 * Famílias de interação descritas por efeitos, sem pares de nomes: uma ação cria
 * ou muda um estado do combate e a próxima se beneficia (ou é prejudicada).
 * A detecção só aponta a pergunta; quem mede é a simulação (`value.ts`) ou as
 * contas abaixo (ativações por acerto, ciclo do combo).
 */
import type { EffectDef, EffectState } from "./effects.ts";

export type Family =
  | "grouping" // agrupamento + habilidade em área
  | "restraintDelayed" // restrição de movimento + detonação atrasada
  | "zoneDot" // permanência em zona + dano contínuo
  | "onHit" // ataques frequentes + efeito por acerto
  | "shredDamage" // redução de resistência + dano
  | "defenseExposure" // defesa + habilidade que exige exposição
  | "cooldownCombo"; // redução de cooldown + combo

export const FAMILY_LABEL: Record<Family, string> = {
  grouping: "agrupar alvos para uma área",
  restraintDelayed: "prender o alvo até a detonação",
  zoneDot: "manter o alvo no dano contínuo",
  onHit: "acertos frequentes ativando efeito por acerto",
  shredDamage: "reduzir resistência antes do dano",
  defenseExposure: "sobreviver para concluir a jogada",
  cooldownCombo: "combo volta mais cedo",
};

export const FAMILY_QUESTION: Record<Family, string> = {
  grouping: "Quantos alvos a mais estão dentro da área no instante do impacto?",
  restraintDelayed: "O alvo que escaparia continua dentro quando a habilidade resolve?",
  zoneDot: "Quantos ticks a mais atingem o alvo antes de ele sair, dissipar ou morrer?",
  onHit: "Quantas ativações elegíveis ocorrem, com cooldown interno, limite de acúmulo e duração da luta?",
  shredDamage: "Quanto dano do tipo certo entra na janela da redução?",
  defenseExposure: "A proteção cobre a ameaça que impedia a execução? Quanto da jogada o herói conclui?",
  cooldownCombo: "A sequência inteira volta mais cedo ou outra peça continua limitando?",
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
        push({ family: "grouping", setup, payoff, question: FAMILY_QUESTION.grouping, risk: payoff.state === "dot" ? "Puxar depois de lançar a área tira os alvos do dano contínuo." : undefined });
      if (RESTRAINT.includes(setup.state) && isDelayed(payoff)) push({ family: "restraintDelayed", setup, payoff, question: FAMILY_QUESTION.restraintDelayed });
      if (RESTRAINT.includes(setup.state) && payoff.state === "dot" && isArea(payoff)) push({ family: "zoneDot", setup, payoff, question: FAMILY_QUESTION.zoneDot });
      if (setup.state === "resistShred" && (payoff.state === "damage" || payoff.state === "dot") && payoff.damageType === setup.damageType)
        push({ family: "shredDamage", setup, payoff, question: FAMILY_QUESTION.shredDamage });
      if (HARD.includes(setup.state) && HARD.includes(payoff.state) && setup.state !== "pull")
        push({ family: "restraintDelayed", setup, payoff, question: "Controle sobreposto: quanto tempo ou quantas ações a mais ele afeta?", risk: "Dois controles ao mesmo tempo impedem a mesma ação: só conta o tempo a mais." });
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
