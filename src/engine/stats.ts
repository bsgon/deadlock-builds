import type { Hero, Item } from "../data/types.ts";
import { NO_BONUS, type ConditionalBonus } from "./conditional.ts";
import type { Progression, Spending } from "./progression.ts";
import { effectiveHealth, stackMultiplicative } from "./resist.ts";

export interface HeroStats {
  spiritPower: number;
  /** Bônus total de dano de arma em %. */
  weaponDamagePct: number;
  fireRatePct: number;
  bulletDamage: number;
  bulletsPerShot: number;
  shotsPerSecond: number;
  clipSize: number;
  reloadTime: number;
  /** DPS de arma enquanto há balas no pente (tiros no corpo, sem falloff). */
  burstDps: number;
  /** DPS de arma contando o tempo de recarga. */
  sustainedDps: number;
  headshotMultiplier: number;
  health: number;
  healthRegen: number;
  bulletResist: number;
  spiritResist: number;
  /** Vida efetiva contra dano de bala e de spirit. */
  ehpBullet: number;
  ehpSpirit: number;
  cooldownReductionPct: number;
  itemCooldownReductionPct: number;
  durationPct: number;
  rangePct: number;
  radiusPct: number;
  bonusCharges: number;
  /** Amplificação de cura causada (%). */
  healingOutputPct: number;
  bulletLifestealPct: number;
  spiritLifestealPct: number;
  moveSpeed: number;
  sprintSpeed: number;
  stamina: number;
  /** Soma dos MODIFIER_VALUE_* dos itens: inatos mais condicionais ponderados (inclusive os que o motor ainda não usa). */
  itemTotals: Record<string, number>;
}

const M = "MODIFIER_VALUE_";

/** Soma os stats inatos dos itens; resistências ficam em listas para empilhar multiplicativamente. */
function collect(items: Item[]) {
  const totals: Record<string, number> = {};
  const bulletResists: number[] = [];
  const spiritResists: number[] = [];
  for (const item of items) {
    for (const [type, value] of Object.entries(item.innate)) {
      totals[type] = (totals[type] ?? 0) + value;
      if (type === `${M}BULLET_ARMOR_DAMAGE_RESIST`) bulletResists.push(value);
      if (type === `${M}TECH_RESIST`) spiritResists.push(value);
    }
  }
  return { totals, bulletResists, spiritResists };
}

export function computeStats(hero: Hero, items: Item[], prog: Progression, spend: Spending, bonus: ConditionalBonus = NO_BONUS): HeroStats {
  const { totals, bulletResists, spiritResists } = collect(items);
  for (const [type, value] of Object.entries(bonus.totals)) totals[type] = (totals[type] ?? 0) + value;
  bulletResists.push(...bonus.bulletResists);
  spiritResists.push(...bonus.spiritResists);
  const t = (name: string) => totals[M + name] ?? 0;
  const boon = (name: string) => (hero.perBoon[M + name] ?? 0) * prog.boons;
  const start = (name: string) => hero.start[name] ?? 0;

  const spiritPower =
    (boon("TECH_POWER") + spend.bonus.spirit + t("TECH_POWER")) * (1 + t("TECH_POWER_PERCENT") / 100);

  // Escalas próprias do herói com Spirit Power (ex.: Haze ganha pente, Vindicta ganha dano de bala).
  const scaled = (stat: string) =>
    hero.scaling.filter((s) => s.stat === stat && s.source === "ETechPower").reduce((sum, s) => sum + s.scale * spiritPower, 0);

  const weaponDamagePct = spend.bonus.weapon + t("WEAPON_DAMAGE_INCREASE");
  const baseBullet = hero.weapon.bulletDamage + boon("BASE_BULLET_DAMAGE_FROM_LEVEL") + scaled("EBulletDamage");
  const bulletDamage = baseBullet * (1 + weaponDamagePct / 100);

  // ERoundsPerSecond repete EFireRate em outra unidade; usamos só EFireRate para não contar em dobro.
  const fireRatePct = t("FIRE_RATE") + scaled("EFireRate");
  const shotsPerSecond = hero.weapon.shotsPerSecond * (1 + fireRatePct / 100);

  const clipSize = Math.max(
    1,
    Math.round((hero.weapon.clipSize + t("AMMO_CLIP_SIZE") + scaled("EClipSize")) * (1 + t("AMMO_CLIP_SIZE_PERCENT") / 100)),
  );
  const reloadTime = hero.weapon.reloadTime / (1 + t("RELOAD_SPEED") / 100);
  const perShot = bulletDamage * hero.weapon.bullets;
  const burstDps = perShot * shotsPerSecond;
  const sustainedDps = shotsPerSecond > 0 ? (perShot * clipSize) / (clipSize / shotsPerSecond + reloadTime) : 0;

  const baseHealth = start("max_health") + boon("BASE_HEALTH_FROM_LEVEL");
  const health =
    (baseHealth * (1 + (spend.bonus.vitality + t("BASE_HEALTH_PERCENT")) / 100) + t("HEALTH_MAX")) *
    (1 + t("HEALTH_MAX_PERCENT") / 100);

  const bulletResist = stackMultiplicative(
    [...bulletResists, boon("BULLET_ARMOR_DAMAGE_RESIST"), scaled("EBulletArmorDamageReduction")].filter((r) => r !== 0),
  );
  const spiritResist = stackMultiplicative(
    [...spiritResists, boon("TECH_RESIST"), scaled("ETechArmorDamageReduction")].filter((r) => r !== 0),
  );

  return {
    spiritPower,
    weaponDamagePct,
    fireRatePct,
    bulletDamage,
    bulletsPerShot: hero.weapon.bullets,
    shotsPerSecond,
    clipSize,
    reloadTime,
    burstDps,
    sustainedDps,
    headshotMultiplier: hero.weapon.headshotMultiplier,
    health,
    healthRegen: start("base_health_regen") + t("HEALTH_REGEN_PER_SECOND") + scaled("EBaseHealthRegen"),
    bulletResist,
    spiritResist,
    ehpBullet: effectiveHealth(health, bulletResist),
    ehpSpirit: effectiveHealth(health, spiritResist),
    cooldownReductionPct: Math.min(100, t("COOLDOWN_REDUCTION_PERCENTAGE")),
    itemCooldownReductionPct: Math.min(100, t("ITEM_COOLDOWN_REDUCTION_PERCENTAGE")),
    durationPct: t("BONUS_ABILITY_DURATION_PERCENTAGE"),
    rangePct: t("TECH_RANGE_PERCENT"),
    radiusPct: t("TECH_RADIUS_PERCENT"),
    bonusCharges: t("BONUS_ABILITY_CHARGES"),
    healingOutputPct: t("HEAL_AMP_CAST_PERCENT"),
    bulletLifestealPct: t("BULLET_LIFESTEAL"),
    spiritLifestealPct: t("TECH_LIFESTEAL"),
    moveSpeed: start("max_move_speed") + t("MOVEMENT_SPEED_MAX") + scaled("EMaxMoveSpeed"),
    sprintSpeed: start("sprint_speed") + t("SPRINT_SPEED_BONUS") + scaled("ESprintSpeed"),
    stamina: start("stamina") + t("STAMINA"),
    itemTotals: totals,
  };
}
