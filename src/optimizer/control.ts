/**
 * Controle de grupo (crowd control): segundos de controle aplicados por minuto,
 * somando habilidades desbloqueadas e itens.
 *
 * Cada efeito vale `duração × usos por minuto × peso do tipo`. Os pesos dizem o
 * quanto o efeito tira do inimigo (um stun tira tudo; um slow de 30% tira pouco)
 * e são escolhas do projeto, não números do jogo. Como as métricas de dano, é um
 * índice para comparar builds do mesmo herói: assume que a habilidade é usada
 * sempre que sai do cooldown e acerta.
 */
import type { GameData, Item } from "../data/types.ts";
import { evaluateBuild, resolveProperties, type BuildResult, type ResolvedProperty } from "../engine/index.ts";
import { contextId, memoByObject } from "../engine/memo.ts";
import { tr } from "../i18n.ts";

export type ControlKind = "stun" | "immobilize" | "sleep" | "silence" | "hex" | "disarm" | "tether" | "slow" | "fireRateSlow";

/** Quanto cada segundo do efeito vale, comparado a um segundo de stun. */
export const CONTROL_WEIGHTS: Record<ControlKind, number> = {
  stun: 1,
  immobilize: 0.8,
  sleep: 0.8, // quebra com dano
  silence: 0.6,
  hex: 0.6,
  disarm: 0.5,
  tether: 0.4,
  slow: 0.5, // multiplicado pela fração do slow (30% → 0,15)
  fireRateSlow: 0.3, // idem
};

// Rótulos como getters: o idioma só é definido depois de o módulo carregar.
export const CONTROL_LABEL: Record<ControlKind, string> = {
  get stun() {
    return tr("stun", "stun");
  },
  get immobilize() {
    return tr("imobiliza", "immobilize");
  },
  get sleep() {
    return tr("sono", "sleep");
  },
  get silence() {
    return tr("silêncio", "silence");
  },
  get hex() {
    return tr("hex", "hex");
  },
  get disarm() {
    return tr("desarme", "disarm");
  },
  get tether() {
    return tr("prende", "tether");
  },
  get slow() {
    return tr("lentidão", "slow");
  },
  get fireRateSlow() {
    return tr("lentidão de tiro", "fire rate slow");
  },
};

/** Controle em área pega mais de um inimigo de vez em quando. */
const AREA_BONUS = 1.3;
/** Duração assumida quando o efeito não diz quanto dura. */
const FALLBACK_DURATION = 2;

const DURATION_KEYS: [ControlKind, RegExp][] = [
  ["stun", /^(Stun|StompStun|Freeze|Toss)Duration$/], // toss = arremessado no ar (knockup)
  ["immobilize", /^ImmobilizeDuration$/],
  ["sleep", /^SleepDuration$/],
  ["silence", /^SilenceDuration$/],
  ["hex", /^HexDuration$/],
  ["disarm", /^Disarm(ed)?Duration$/],
  ["tether", /^(Tether|Chain)Duration$/],
];
/** Marcadores de efeito sem duração própria (a duração vem do efeito todo). */
const STATUS_KEYS: [ControlKind, RegExp][] = [
  ["stun", /^StatusEffectStun$/],
  ["immobilize", /^StatusEffectImmobilize$/],
  ["disarm", /^StatusEffectDisarmed$/],
];
/** Efeitos citados só no texto (ex.: Silence Wave). */
/** Frases em que o efeito cai em você (o item reage a ele), não no inimigo. */
const ON_YOU = /immune to|silences you|when you('re| are| get| become)|while (you are )?(stunned|silenced)|if you are|non-stun/i;
const TEXT_EFFECTS: [ControlKind, RegExp, RegExp][] = [
  ["silence", /silenc/i, ON_YOU],
  ["disarm", /disarm/i, ON_YOU],
  ["stun", /\bstun/i, ON_YOU],
];
const SLOW_PCT = /^(Slow(Percent|Pct)?|MoveSlowPercent|EnemySlowPct|Move(ment)?Speed(And(Dash)?)?Slow(Pct|Percent|MaxPct)?|MovementSlow(Pct)?|FadingSlowPercent|MaxSlow(Percent)?|CoatedSlowPercent|ClubSlowPercent|HeavyMeleeSlowPercent|BigExplosionSlowPercent|MovementSpeedSlow)$/;
const SLOW_DURATION = /^(Slow|MoveSlow|MovementSlow|EnemySlow|MaxSlow|CoatedSlow|HeavyMeleeSlow)(Duration|Time)$/;
const FIRE_RATE_PCT = /^(FireRateSlow|MaxFireRateSlowPercent)$/;
const EFFECT_DURATION = ["AbilityDuration", "DebuffDuration", "AbilityChannelTime"];

export interface ControlSource {
  name: string;
  from: "ability" | "item";
  /** Segundos de controle (ponderados) por minuto. */
  perMinute: number;
  kinds: ControlKind[];
}

/**
 * Valor resolvido, limitado a 2× a base: itens de duração dão no máximo ~+50%, e
 * algumas escalas do jogo somam Spirit Power à duração por engano (ex.: o stun de
 * Close The Deal sai de 0,5 s para 27 s).
 */
const val = (p: ResolvedProperty | undefined) => {
  if (!p) return 0;
  const v = Math.abs(p.value);
  return p.base !== 0 && /s$/.test(p.unit) ? Math.min(v, Math.abs(p.base) * 2) : v;
};
const maxOf = (props: Record<string, ResolvedProperty>, re: RegExp) =>
  Object.entries(props).reduce((m, [k, p]) => (re.test(k) ? Math.max(m, val(p)) : m), 0);

/** Um efeito de controle: quanto dura cada aplicação e a força (1 = controle total; slow de 30% = 0,3). */
interface Effect {
  duration: number;
  strength: number;
}

// Propriedades resolvidas vêm de um cache (mesmo objeto para a mesma fonte e os mesmos
// stats) e não mudam: o que só depende delas e do texto é calculado uma vez.
const effectsCache = new WeakMap<Record<string, ResolvedProperty>, Map<string, Map<ControlKind, Effect>>>();
const areaCache = new WeakMap<Record<string, ResolvedProperty>, boolean>();

/** Efeitos de controle de um uso da habilidade ou do item, por tipo (cópia: quem chama pode alterar o mapa). */
function controlEffects(props: Record<string, ResolvedProperty>, text: string): Map<ControlKind, Effect> {
  let byText = effectsCache.get(props);
  if (!byText) effectsCache.set(props, (byText = new Map()));
  let hit = byText.get(text);
  if (!hit) byText.set(text, (hit = controlEffectsUncached(props, text)));
  return new Map(hit);
}

function controlEffectsUncached(props: Record<string, ResolvedProperty>, text: string): Map<ControlKind, Effect> {
  const out = new Map<ControlKind, Effect>();
  const effect = EFFECT_DURATION.map((k) => val(props[k])).find((v) => v > 0) ?? 0;
  const slowDuration = maxOf(props, SLOW_DURATION) || effect || FALLBACK_DURATION;
  for (const [kind, re] of DURATION_KEYS) {
    const d = maxOf(props, re);
    if (d > 0) out.set(kind, { duration: d, strength: 1 });
  }
  for (const [kind, re] of STATUS_KEYS) {
    if (!out.has(kind) && Object.keys(props).some((k) => re.test(k))) out.set(kind, { duration: effect || slowDuration, strength: 1 });
  }
  // Efeito só citado no texto: dura o mesmo que o efeito todo (ou o slow que vem junto),
  // até 2 s, já que a duração do efeito todo costuma ser maior que a do controle.
  const textDuration = Math.min(FALLBACK_DURATION, effect || maxOf(props, SLOW_DURATION));
  for (const [kind, re, unless] of TEXT_EFFECTS) {
    if (!out.has(kind) && textDuration > 0 && re.test(text) && !unless.test(text)) out.set(kind, { duration: textDuration, strength: 1 });
  }
  const slow = Math.min(100, maxOf(props, SLOW_PCT));
  if (slow > 0) out.set("slow", { duration: slowDuration, strength: slow / 100 });
  const fireRate = Math.min(100, maxOf(props, FIRE_RATE_PCT));
  if (fireRate > 0) out.set("fireRateSlow", { duration: val(props.FireRateSlowDuration) || effect || FALLBACK_DURATION, strength: fireRate / 100 });
  return out;
}

const hasArea = (props: Record<string, ResolvedProperty>) => {
  let hit = areaCache.get(props);
  if (hit === undefined) areaCache.set(props, (hit = Object.entries(props).some(([k, p]) => /Radius$/.test(k) && !/^Tech/.test(k) && (p.value ?? 0) > 0)));
  return hit;
};

/** Texto do item (todas as seções), montado uma vez por item. */
const textCache = new WeakMap<Item, string>();
const itemText = (item: Item) => {
  let text = textCache.get(item);
  if (text === undefined) textCache.set(item, (text = item.sections.map((s) => s.text).join(" ")));
  return text;
};

/** Nenhum efeito conta como ativo em mais da metade do tempo: o inimigo sai do alcance, usa cura, tem imunidade. */
const MAX_ACTIVE_SHARE = 0.5;
/** Cooldown mínimo considerado (cargas e reativações rápidas não aplicam controle sem parar). */
const MIN_COOLDOWN = 4;
/** Cada slow a mais sobre o mesmo inimigo vale esta fração do anterior. */
const SLOW_STACKING = 0.5;

type ByKind = Map<ControlKind, number>;

/**
 * Segundos ponderados de controle por minuto, por tipo. `active` é a fração do
 * tempo em que cada efeito fica aplicado; o resto é peso × força.
 */
function perMinute(effects: Map<ControlKind, Effect>, active: (e: Effect) => number, scale: number): ByKind {
  const out: ByKind = new Map();
  for (const [kind, e] of effects) out.set(kind, CONTROL_WEIGHTS[kind] * e.strength * 60 * Math.min(MAX_ACTIVE_SHARE, active(e)) * scale);
  return out;
}

/** Efeito com cooldown: ativo por duração ÷ cooldown do tempo. */
const everyCooldown = (cooldown: number) => (e: Effect) => e.duration / Math.max(MIN_COOLDOWN, cooldown);

// Controle por item e por habilidade: só depende das propriedades resolvidas (objeto de
// cache, imutável) e dos números no contexto. Quem chama altera o mapa: sai uma cópia.
const itemControlMemo = memoByObject<Record<string, ResolvedProperty>, ByKind | null>();
const abilityControlMemo = memoByObject<Record<string, ResolvedProperty>, ByKind | null>();
const ULTIMATE = /your ultimate/i;

const ultimateItems = new WeakMap<Item, boolean>();
const usesUltimate = (item: Item) => {
  let hit = ultimateItems.get(item);
  if (hit === undefined) ultimateItems.set(item, (hit = ULTIMATE.test(itemText(item))));
  return hit;
};

/** `contexts`: [sem a ultimate, com a ultimate] — a ultimate só entra na conta de itens disparados por ela. */
function itemControl(item: Item, build: BuildResult, uptime: number, firing: number, ultimate: number | null, contexts: [number, number]): ByKind | null {
  const props = resolveProperties(item.properties, [], build.stats, build.progression.boons);
  const context = contexts[usesUltimate(item) ? 1 : 0];
  const hit = itemControlMemo(props, context, () => itemControlUncached(item, props, build, uptime, firing, ultimate));
  return hit ? new Map(hit) : null;
}

/** Cooldown da ultimate desbloqueada (o que itemControl lê das habilidades), null sem ela. */
function ultimateCooldown(build: BuildResult): number | null {
  const ult = build.abilities.find((a) => a.slot === 4 && a.slot <= build.progression.abilityUnlocks);
  return ult ? val(ult.properties.AbilityCooldown) || 120 : null;
}

function itemControlUncached(item: Item, props: Record<string, ResolvedProperty>, build: BuildResult, uptime: number, firing: number, ultimate: number | null): ByKind | null {
  const text = itemText(item);
  const effects = controlEffects(props, text);
  // Item que tem campo de slow mas não fala em slow aplica o efeito em você, não no inimigo.
  if (!/slow|reduc/i.test(text)) {
    effects.delete("slow");
    effects.delete("fireRateSlow");
  }
  if (effects.size === 0) return null;
  // Passivos só valem quando a condição acontece: atirando, ou em luta; corpo a corpo, metade disso.
  let share = /bullets?|shots?|shoot/i.test(text) ? firing : uptime;
  if (/melee/i.test(text)) share *= build.meleeShare;
  let cooldown = val(props.AbilityCooldown) || val(props.ProcCooldown);
  // Disparado pela ultimate (ex.: Lightning Scroll): uma vez por cooldown da ultimate.
  if (ULTIMATE.test(text)) {
    if (ultimate === null) return null;
    cooldown = ultimate;
    share = 1;
  }
  // Acúmulo com imunidade depois (ex.: Silencer): no máximo um efeito por duração + imunidade.
  const immunity = val(props.ImmunityDuration);
  if (!item.isActive && immunity > 0) cooldown = immunity + Math.max(...[...effects.values()].map((e) => e.duration));

  if (item.isActive) return perMinute(effects, everyCooldown(cooldown || 30), hasArea(props) ? AREA_BONUS : 1);
  if (cooldown > 0) return perMinute(effects, everyCooldown(cooldown), share);
  return perMinute(effects, () => share, 1); // contínuo: ativo enquanto a condição dura
}

/**
 * Fontes de controle da build, da que mais controla para a que menos. Controle
 * duro (stun, silêncio...) soma; slows se sobrepõem, então cada slow a mais vale
 * metade do anterior (o mais forte conta inteiro).
 */
export function controlSources(build: BuildResult, uptime: number, firing: number): ControlSource[] {
  const raw: { name: string; from: ControlSource["from"]; byKind: ByKind }[] = [];
  for (const ability of build.abilities) {
    if (ability.slot > build.progression.abilityUnlocks) continue; // ainda não desbloqueada
    const byKind = abilityControlMemo(ability.properties, contextId([uptime]), () => {
      const effects = controlEffects(ability.properties, ability.text);
      if (effects.size === 0) return null;
      const cooldown = val(ability.properties.AbilityCooldown);
      // Sem cooldown (passiva ou aura): ativa pela fração do tempo em luta.
      return perMinute(effects, cooldown > 0 ? everyCooldown(cooldown) : () => uptime, hasArea(ability.properties) ? AREA_BONUS : 1);
    });
    if (!byKind) continue;
    raw.push({ name: ability.name, from: "ability", byKind: new Map(byKind) });
  }
  const ultimate = ultimateCooldown(build);
  const contexts: [number, number] = [contextId([uptime, firing, build.meleeShare, "-"]), contextId([uptime, firing, build.meleeShare, String(ultimate)])];
  for (const item of build.items) {
    const byKind = itemControl(item, build, uptime, firing, ultimate, contexts);
    if (byKind) raw.push({ name: item.name, from: "item", byKind });
  }
  for (const kind of ["slow", "fireRateSlow"] as const) {
    const ranked = raw.filter((r) => (r.byKind.get(kind) ?? 0) > 0).sort((a, b) => b.byKind.get(kind)! - a.byKind.get(kind)!);
    ranked.forEach((r, i) => r.byKind.set(kind, r.byKind.get(kind)! * SLOW_STACKING ** i));
  }
  return raw
    .map((r) => ({ name: r.name, from: r.from, kinds: [...r.byKind.keys()], perMinute: [...r.byKind.values()].reduce((s, v) => s + v, 0) }))
    .filter((s) => s.perMinute > 0)
    .sort((a, b) => b.perMinute - a.perMinute);
}

/** Controle mínimo do kit (s/min) para o objetivo "Controle" fazer sentido. */
export const CONTROL_MIN_PER_MINUTE = 1.5;
/** Ponto de referência para medir o kit: meio de partida, um upgrade em cada habilidade. */
const KIT_SOULS = 20_000;

const kitCache = new WeakMap<GameData, Map<string, number>>();

/** Segundos de controle por minuto do kit do herói, sem itens. */
export function heroControl(data: GameData, heroName: string): number {
  let cache = kitCache.get(data);
  if (!cache) kitCache.set(data, (cache = new Map()));
  const hit = cache.get(heroName);
  if (hit !== undefined) return hit;
  const build = evaluateBuild(data, { hero: heroName, souls: KIT_SOULS, abilityTiers: [1, 1, 1, 1] });
  const total = controlSources(build, 0.5, 0.5).reduce((sum, s) => sum + s.perMinute, 0);
  cache.set(heroName, total);
  return total;
}
