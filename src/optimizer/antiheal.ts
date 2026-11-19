/**
 * Valor de reduzir a cura do inimigo (Healbane, Toxic Bullets, Spirit Burn...).
 *
 * Cura que o inimigo deixa de receber equivale a dano a mais. Quanto o inimigo
 * cura numa luta acompanha o dano trocado: nas partidas normais, a cada minuto
 * os jogadores curam uma fração do dano que causam em heróis, fração que cresce
 * com a partida (lifesteal, itens de cura). A fração vem da curva de desempenho
 * da deadlock-api.com (`player_healing_avg` / `player_damage_avg`, por minuto,
 * todos os heróis, novembro de 2026), indexada pelos souls médios do minuto.
 */
import type { Item } from "../data/types.ts";
import type { BuildResult } from "../engine/index.ts";
import { itemUptime } from "../engine/conditional.ts";

/** [souls, cura recebida por dano causado] no ritmo médio da partida. */
const HEAL_PER_DAMAGE: [number, number][] = [
  [0, 0.2],
  [4800, 0.22],
  [7500, 0.245],
  [10500, 0.285],
  [15000, 0.32],
  [21000, 0.355],
  [27600, 0.365],
  [42000, 0.37],
];

/** Fração do dano trocado que o inimigo cura naquele ponto da partida. */
export function enemyHealPerDamage(souls: number): number {
  const after = HEAL_PER_DAMAGE.findIndex(([s]) => s > souls);
  if (after === -1) return HEAL_PER_DAMAGE[HEAL_PER_DAMAGE.length - 1]![1];
  const [s0, r0] = HEAL_PER_DAMAGE[after - 1]!;
  const [s1, r1] = HEAL_PER_DAMAGE[after]!;
  return r0 + ((souls - s0) / (s1 - s0)) * (r1 - r0);
}

/** Redução que cai em quem usa o item (Cheat Death), não no inimigo. */
const ON_SELF = /you deal reduced damage|have reduced healing/i;
const NEEDS_SPIRIT = /spirit damage/i;
const NEEDS_BULLETS = /bullet|headshot/i;

export interface AntiHealSource {
  item: Item;
  /** Redução de cura, em % (positivo). */
  penalty: number;
  /** Fração da luta em que o inimigo está com a redução. */
  coverage: number;
}

/**
 * Itens que reduzem a cura do inimigo, com a fração da luta coberta. O efeito
 * precisa de dano spirit ou de bala para ser aplicado, conforme o item.
 */
export function antiHealSources(build: BuildResult, uptime: number, firing: number, spiritDps: number): AntiHealSource[] {
  const out: AntiHealSource[] = [];
  for (const item of build.items) {
    const penalty = -(item.properties.HealAmpReceivePenaltyPercent?.value ?? 0);
    if (penalty <= 0) continue;
    const text = item.sections.map((s) => s.text).join(" ");
    // Decay não cita a redução no texto, mas a propriedade está lá.
    if (ON_SELF.test(text)) continue;
    if (NEEDS_SPIRIT.test(text) && spiritDps <= 0) continue;
    if (!item.isActive && NEEDS_BULLETS.test(text) && firing <= 0) continue;
    out.push({ item, penalty, coverage: itemUptime(item, uptime, undefined, undefined, build.meleeShare) });
  }
  return out;
}

/**
 * Dano equivalente por segundo da cura negada. Reduções de itens diferentes não
 * se somam aqui: conta a mais forte (redução × cobertura), para não premiar
 * empilhar o mesmo efeito.
 */
export function antiHealDps(build: BuildResult, damageDps: number, uptime: number, firing: number, spiritDps: number): number {
  const best = antiHealSources(build, uptime, firing, spiritDps).reduce((max, s) => Math.max(max, (s.penalty / 100) * s.coverage), 0);
  return best * enemyHealPerDamage(build.souls) * damageDps;
}
