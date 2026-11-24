/**
 * Estimativa dos efeitos condicionais dos itens (procs, ativos, "enquanto X").
 *
 * O jogo não diz com que frequência cada condição está ativa, então o motor
 * usa um fator de tempo ativo entre 0 e 1 para cada bônus:
 *  - item de imbuir: vale para 1 das 4 habilidades (0,25);
 *  - efeito ativo com duração e cooldown: duração / cooldown;
 *  - efeito passivo com duração e cooldown: o menor entre o uptime informado e duração / cooldown;
 *  - "seu próximo tiro/ataque": só os tiros afetados, ou seja, tiros do proc / (cooldown x tiros por segundo);
 *  - "acima/abaixo de X% da sua vida": a fração da luta nessa faixa (healthShare);
 *  - "ao lançar a ultimate": só nas lutas em que ela está pronta;
 *  - demais condições: o uptime informado pelo usuário;
 *  - efeitos de corpo a corpo valem pelo uso de melee do herói (das estatísticas de
 *    compra; 0,5 sem dados); aparar, dash-jump ou slide valem metade.
 * É uma aproximação para comparar builds, não um valor exato de combate.
 */
import type { Item, ItemSection } from "../data/types.ts";
import { FIGHT_EVERY_SECONDS } from "./rules.ts";

const M = "MODIFIER_VALUE_";

/** Debuffs que reduzem resistência do alvo. */
const SPIRIT_SHRED = new Set([`${M}TECH_RESIST_REDUCTION`]);
const BULLET_SHRED = new Set([`${M}BULLET_AND_MELEE_RESIST_REDUCTION`]);

/** Tipos que afetam o inimigo ou não entram em nenhuma conta do motor. */
const NOT_SELF = new Set(
  ["MOVEMENT_SPEED_SLOW_PERCENT", "FIRE_RATE_SLOW", "MELEE_RESIST_REDUCTION", "BULLET_RESIST_NON_HERO", "WEAPON_DAMAGE_TO_NPC_INCREASE", "RESPAWN_TIME_PERCENTAGE"].map((t) => M + t),
);

/** Tiros por segundo assumidos quando o chamador não informa a arma. */
const DEFAULT_SHOTS_PER_SECOND = 5;

export interface ConditionalBonus {
  /** Stats próprios ponderados pelo tempo ativo (MODIFIER_VALUE_* -> valor). */
  totals: Record<string, number>;
  bulletResists: number[];
  spiritResists: number[];
  /** Redução média de resistência aplicada ao alvo, em %. */
  bulletShredPct: number;
  spiritShredPct: number;
}

export const NO_BONUS: ConditionalBonus = { totals: {}, bulletResists: [], spiritResists: [], bulletShredPct: 0, spiritShredPct: 0 };

const isImbue = (item: Item) => /\bimbue/i.test(item.text) || item.sections.some((s) => /\bimbue/i.test(s.text));
const NEXT_SHOT = /your next (bullet|attack|headshot)/i;
/** Gatilho de ataque corpo a corpo: vale pelo quanto o herói usa melee (`melee`). */
const MELEE = /melee/i;
/** Outras ações específicas do jogador (aparar, dash-jump, slide): valem metade. */
const OTHER_ACTION = /parry|dash-jump|when sliding/i;
/** Uso de melee quando o chamador não informa o do herói. */
export const DEFAULT_MELEE = 0.5;

/** Condição de vida do próprio herói. */
const OWN_HEALTH = /(?:you are|when|while) (above|below) (\d+)% health/i;
const ULTIMATE_TRIGGER = /casting an ultimate/i;
/** Uptime em que a fração da luta calculada vale inteira; outros uptimes a escalam. */
const REFERENCE_UPTIME = 0.5;

/** Fração da luta com a própria vida abaixo (ou acima) de `percent` (regra health-condition). */
export function healthShare(side: "above" | "below", percent: number): number {
  const x = Math.min(0.999, percent / 100);
  const below = x + (1 - x) * Math.log(1 - x);
  return side === "below" ? below : 1 - below;
}

/** Fração das lutas em que a ultimate está pronta. */
export const ultimateReady = (cooldown: number) => (cooldown > 0 ? Math.min(1, FIGHT_EVERY_SECONDS / cooldown) : 1);

/** O efeito do item sai ao lançar a ultimate. */
export const triggersOnUltimate = (item: Item) => item.sections.some((s) => ULTIMATE_TRIGGER.test(s.text));

function sectionOf(item: Item, key: string): ItemSection | undefined {
  return item.sections.find((s) => s.type !== "innate" && (s.properties.includes(key) || s.important.includes(key)));
}

/**
 * Fração do tempo em que um bônus condicional do item está valendo.
 * Sem `key`, devolve o fator geral do item (usado para efeitos contínuos).
 */
export function itemUptime(item: Item, uptime: number, key?: string, shotsPerSecond = DEFAULT_SHOTS_PER_SECOND, meleeUse = DEFAULT_MELEE, ultimateCooldown = 0): number {
  if (isImbue(item)) return 0.25;
  const section = key ? sectionOf(item, key) : undefined;
  const isActive = section ? section.type === "active" : item.isActive;
  const text = section?.text ?? "";
  const duration = item.properties.AbilityDuration?.value ?? 0;
  const cooldown = item.properties.AbilityCooldown?.value ?? 0;
  const melee = MELEE.test(text) ? meleeUse : OTHER_ACTION.test(text) ? 0.5 : 1;

  if (NEXT_SHOT.test(text) && cooldown > 0) {
    // O bônus vale só para o(s) tiro(s) do proc, não para o tempo todo.
    const shots = item.properties.ProcAmmoConsumed?.value || 1;
    return Math.min(uptime, shots / (cooldown * Math.max(shotsPerSecond, 0.1))) * melee;
  }
  const health = OWN_HEALTH.exec(text);
  if (health) {
    const share = Math.min(1, (healthShare(health[1]!.toLowerCase() as "above" | "below", Number(health[2])) * uptime) / REFERENCE_UPTIME);
    return (duration > 0 && cooldown > 0 ? Math.min(share, duration / cooldown) : share) * melee;
  }
  if (ULTIMATE_TRIGGER.test(text)) return uptime * ultimateReady(ultimateCooldown) * melee;
  if (duration > 0 && cooldown > 0) {
    const cycle = Math.min(1, duration / cooldown);
    return (isActive ? cycle : Math.min(uptime, cycle)) * melee;
  }
  return uptime * melee;
}

function stack(percents: number[]): number {
  return (1 - percents.reduce((rest, p) => rest * (1 - p / 100), 1)) * 100;
}

export function conditionalBonus(items: Item[], uptime: number, shotsPerSecond = DEFAULT_SHOTS_PER_SECOND, meleeUse = DEFAULT_MELEE, ultimateCooldown = 0): ConditionalBonus {
  if (uptime <= 0) return NO_BONUS;
  const totals: Record<string, number> = {};
  const bulletResists: number[] = [];
  const spiritResists: number[] = [];
  const bulletShreds: number[] = [];
  const spiritShreds: number[] = [];

  for (const item of items) {
    for (const key of item.conditional) {
      const prop = item.properties[key];
      if (!prop?.provides) continue;
      const type = prop.provides;
      const factor = itemUptime(item, uptime, key, shotsPerSecond, meleeUse, ultimateCooldown);
      if (SPIRIT_SHRED.has(type)) spiritShreds.push(Math.abs(prop.value) * factor);
      else if (BULLET_SHRED.has(type)) bulletShreds.push(Math.abs(prop.value) * factor);
      else if (NOT_SELF.has(type) || prop.value <= 0) continue; // penalidades e valores negativos ficam de fora
      else if (type === `${M}BULLET_ARMOR_DAMAGE_RESIST`) bulletResists.push(prop.value * factor);
      else if (type === `${M}TECH_RESIST`) spiritResists.push(prop.value * factor);
      else totals[type] = (totals[type] ?? 0) + prop.value * factor;
    }
  }
  return { totals, bulletResists, spiritResists, bulletShredPct: stack(bulletShreds), spiritShredPct: stack(spiritShreds) };
}
