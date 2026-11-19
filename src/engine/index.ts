import type { Ability, GameData, Hero, Item } from "../data/types.ts";
import { resolveAbility, type ResolvedAbility } from "./abilities.ts";
import { conditionalBonus, type ConditionalBonus } from "./conditional.ts";
import { abilityPointsSpent, progressionFromSouls, spending, type Progression, type Spending } from "./progression.ts";
import { equippedItems } from "./inventory.ts";
import { meleeShare } from "../meta/stats.ts";
import { BASE_ITEM_SLOTS, MAX_ACTIVE_ITEMS, MAX_ITEM_SLOTS } from "./rules.ts";
import { computeStats, type HeroStats } from "./stats.ts";

export * from "./abilities.ts";
export * from "./conditional.ts";
export * from "./inventory.ts";
export * from "./progression.ts";
export * from "./resist.ts";
export * from "./rules.ts";
export * from "./stats.ts";

export interface BuildInput {
  /** Nome ou class_name do herói. */
  hero: string;
  /** Souls acumulados na partida (define nível e limita o gasto). */
  souls: number;
  /** Nomes ou class_name dos itens comprados. */
  items?: string[];
  /** Upgrades comprados por habilidade, na ordem dos slots (0 a 3 cada). */
  abilityTiers?: number[];
  /** Slots de item liberados (9 a 12). */
  itemSlots?: number;
  /**
   * Fração do tempo (0 a 1) em que efeitos condicionais dos itens estão ativos.
   * Padrão 0: só stats sempre ativos entram no cálculo.
   */
  uptime?: number;
  /**
   * Quanto o herói usa ataque corpo a corpo (0 a 1): fração do tempo em luta em
   * que efeitos "ao acertar melee" disparam. Padrão: vem das estatísticas de compra
   * dos itens de melee com o herói (0,5 sem estatísticas).
   */
  meleeShare?: number;
}

export interface BuildResult {
  hero: Hero;
  items: Item[];
  /** Souls da partida usados no cálculo. */
  souls: number;
  progression: Progression;
  spending: Spending;
  stats: HeroStats;
  abilities: ResolvedAbility[];
  /** Efeitos condicionais estimados (vazio quando uptime é 0). */
  conditional: ConditionalBonus;
  /** Uso de melee do herói considerado nos efeitos de corpo a corpo (0 a 1). */
  meleeShare: number;
  /** Problemas da build (souls insuficientes, slots, pontos de habilidade...). */
  warnings: string[];
}

const norm = (s: string) => s.trim().toLowerCase();

// Buscas por nome repetidas a cada avaliação de build: memorizadas por lista (a mesma
// lista dá sempre o mesmo primeiro resultado).
const heroLookup = new WeakMap<Hero[], Map<string, Hero>>();
const itemLookup = new WeakMap<Item[], Map<string, Item>>();
const abilityLookup = new WeakMap<Ability[], Map<Hero, Ability[]>>();

function lookup<T>(cache: WeakMap<T[], Map<string, T>>, list: T[], ref: string, match: (x: T) => boolean): T | undefined {
  let byRef = cache.get(list);
  if (!byRef) cache.set(list, (byRef = new Map()));
  let hit = byRef.get(ref);
  if (hit === undefined) {
    hit = list.find(match);
    if (hit !== undefined) byRef.set(ref, hit);
  }
  return hit;
}

export function findHero(data: GameData, ref: string): Hero {
  const hero = lookup(heroLookup, data.heroes, ref, (h) => norm(h.name) === norm(ref) || h.className === ref);
  if (!hero) throw new Error(`Herói não encontrado: ${ref}`);
  return hero;
}

export function findItem(data: GameData, ref: string): Item {
  const item = lookup(itemLookup, data.items, ref, (i) => norm(i.name) === norm(ref) || i.className === ref);
  if (!item) throw new Error(`Item não encontrado: ${ref}`);
  return item;
}

/** Habilidades do herói por slot. A lista devolvida é compartilhada: não altere. */
export function heroAbilities(data: GameData, hero: Hero): Ability[] {
  let byHero = abilityLookup.get(data.abilities);
  if (!byHero) abilityLookup.set(data.abilities, (byHero = new Map()));
  let list = byHero.get(hero);
  if (!list) byHero.set(hero, (list = data.abilities.filter((a) => a.heroId === hero.id).sort((a, b) => a.slot - b.slot)));
  return list;
}

export function evaluateBuild(data: GameData, input: BuildInput): BuildResult {
  const hero = findHero(data, input.hero);
  const items = (input.items ?? []).map((ref) => findItem(data, ref));
  const tiers = input.abilityTiers ?? [0, 0, 0, 0];
  const slots = input.itemSlots ?? BASE_ITEM_SLOTS;
  const warnings: string[] = [];

  const progression = progressionFromSouls(data.shared, input.souls);

  // Componentes já absorvidos por um item melhorado (em qualquer nível) não ocupam
  // slot nem dão stats; o jogo também não deixa ter dois itens iguais.
  const names = items.map((i) => i.name);
  const duplicates = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  if (duplicates.length > 0) warnings.push(`Itens repetidos (o jogo não permite; contados uma vez): ${duplicates.join(", ")}.`);
  const equipped = equippedItems(data, items);
  const spend = spending(data.shared, equipped);
  if (slots < BASE_ITEM_SLOTS || slots > MAX_ITEM_SLOTS) warnings.push(`Slots de item devem ficar entre ${BASE_ITEM_SLOTS} e ${MAX_ITEM_SLOTS}.`);
  if (equipped.length > slots) warnings.push(`${equipped.length} itens para ${slots} slots.`);
  const actives = equipped.filter((i) => i.isActive).length;
  if (actives > MAX_ACTIVE_ITEMS) warnings.push(`${actives} itens ativos; o máximo é ${MAX_ACTIVE_ITEMS}.`);
  if (spend.total > input.souls) warnings.push(`Build custa ${spend.total} souls, mas só há ${input.souls}.`);

  const abilities = heroAbilities(data, hero);
  const spentPoints = abilityPointsSpent(tiers);
  if (spentPoints > progression.abilityPoints) {
    warnings.push(`Upgrades de habilidade custam ${spentPoints} pontos, mas o nível ${progression.level} dá ${progression.abilityPoints}.`);
  }
  const upgradedLocked = abilities.filter((a) => (tiers[a.slot - 1] ?? 0) > 0 && a.slot > progression.abilityUnlocks);
  if (upgradedLocked.length > 0) {
    warnings.push(`Upgrades em habilidades além das ${progression.abilityUnlocks} desbloqueadas no nível ${progression.level}.`);
  }

  const melee = input.meleeShare ?? meleeShare(data, hero.id);
  const conditional = conditionalBonus(equipped, input.uptime ?? 0, hero.weapon.shotsPerSecond, melee);
  const stats = computeStats(hero, equipped, progression, spend, conditional);
  const resolved = abilities.map((a) => resolveAbility(a, stats, progression.boons, tiers[a.slot - 1] ?? 0));

  return { hero, items: equipped, souls: input.souls, progression, spending: spend, stats, abilities: resolved, conditional, meleeShare: melee, warnings };
}
