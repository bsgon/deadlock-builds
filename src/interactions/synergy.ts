/**
 * Regras de sinergia entre nós etiquetados e consultas sobre o grafo.
 *
 * As pontuações são heurísticas: servem para ordenar e explicar candidatos,
 * não medem ganho real de dano ou vida. A Fase 3 troca isso por números do
 * motor de cálculo.
 */
import type { GameData, Hero, Item } from "../data/types.ts";
import { tagAll, type TaggedData } from "./tagger.ts";
import { meleePickRate, meleeShare } from "../meta/stats.ts";
import type { Interaction } from "../knowledge/interactions.ts";
import { tr, trData } from "../i18n.ts";
import { STAT_LABEL, TRIGGER_LABEL, type Damage, type Node, type Stat, type Trigger } from "./tags.ts";

export interface Link {
  /** Nó que alimenta. */
  from: string;
  /** Nó que se beneficia. */
  to: string;
  rule: string;
  score: number;
  reason: string;
  /** Página da wiki que descreve a interação (regras "wiki:"). */
  source?: string;
}

/** Peso de uma interação conhecida (wiki), por força: detalhe, forte, define a build. */
const KNOWN_SYNERGY = { 1: 0.8, 2: 1.6, 3: 2.4 } as const;
const KNOWN_ANTI = { 1: -0.6, 2: -1.2, 3: -1.8 } as const;

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Interações da wiki entre dois ids (item, habilidade ou `hero:<id>`). */
function knownLinks(graph: Graph, a: string, b: string): Link[] {
  return (graph.known.get(pairKey(a, b)) ?? []).map((i) => ({
    from: i.a,
    to: i.b,
    rule: `wiki:${i.relation}`,
    score: (i.relation === "synergy" ? KNOWN_SYNERGY : KNOWN_ANTI)[i.strength],
    reason: `${i.relation === "anti" ? tr("Não combinam: ", "Don't combine: ") : ""}${trData(i.mechanism)} (wiki)`,
    source: i.source.url,
  }));
}

/** Recursos em que "A concede" + "B escala com" é uma sinergia, e o peso de cada um. */
const FEED_WEIGHT: Partial<Record<Stat, number>> = {
  spiritPower: 1,
  weaponDamage: 1,
  fireRate: 1,
  cooldown: 0.8,
  itemCooldown: 0.7,
  charges: 0.8,
  melee: 0.8,
  duration: 0.6,
  healAmp: 0.6,
  ammo: 0.5,
  range: 0.5,
  reload: 0.4,
};

/**
 * Stats "naturais" de cada árvore da loja: um item de arma escala com dano de arma
 * e cadência, um de spirit com Spirit Power. Ligar um item a eles é óbvio (qualquer
 * jogador sabe), então vale pouco; o mesmo stat alimentando um item de OUTRA árvore
 * (Spirit Power num item de arma que causa dano de spirit) é uma descoberta.
 */
const NATURAL: Record<Item["slot"], Stat[]> = {
  weapon: ["weaponDamage", "fireRate", "ammo", "reload"],
  spirit: ["spiritPower"],
  vitality: [],
};
/** Peso de um reforço óbvio (stat natural da árvore do item que recebe). */
const OBVIOUS = 0.3;
/** Peso extra de um stat que cruza árvores. */
const CROSS_TREE = 1.3;

/** Gatilhos que, quando compartilhados, fazem dois efeitos dispararem na mesma ação. */
const SHARED_TRIGGERS: Trigger[] = ["onHeadshot", "onMelee", "onParry", "closeRange", "longRange", "highHealth", "lowHealth", "onMovement"];
/**
 * Dois itens que pedem a mesma condição (dois de headshot) só somam mais do mesmo:
 * vale pouco. Entre uma habilidade e um item, a condição vem de graça do kit e vale mais.
 */
const SHARED_ITEMS = 0.35;
const SHARED_KIT = 1;

const SPIRIT: Damage[] = ["spirit", "spiritDot", "percentHealth"];
const PHYSICAL: Damage[] = ["weapon", "melee"];
const dealsAny = (n: Node, kinds: Damage[]) => n.deals.some((d) => kinds.includes(d));

/** Sinergias em que `a` alimenta `b`. */
export function linksFrom(a: Node, b: Node): Link[] {
  if (a.id === b.id) return [];
  const out: Link[] = [];
  const push = (rule: string, score: number, reason: string) => out.push({ from: a.id, to: b.id, rule, score, reason });

  // 1. A concede um recurso com o qual B escala.
  const imbueOnItem = a.triggers.includes("imbue") && b.kind === "item";
  for (const [stat, when] of Object.entries(a.gives) as [Stat, "always" | "conditional"][]) {
    const weight = FEED_WEIGHT[stat];
    const wanted = b.wants[stat];
    if (!weight || !wanted) continue;
    if (when === "conditional" && imbueOnItem) continue; // bônus de imbuir só vale para habilidades
    // B também dá o mesmo stat: é só empilhar, não uma sinergia.
    if (a.kind === "item" && b.kind === "item" && b.gives[stat]) continue;
    // Habilidade escala com Spirit Power e arma com dano de arma: também é o esperado.
    const tree: Item["slot"] = b.kind === "item" ? (b.slot ?? "vitality") : b.kind === "ability" ? "spirit" : "weapon";
    const obvious = NATURAL[tree].includes(stat);
    const cross = tree !== null && !obvious && Object.entries(NATURAL).some(([t, stats]) => t !== tree && stats.includes(stat));
    const score = weight * wanted * (when === "always" ? 1 : 0.6) * (obvious ? OBVIOUS : cross ? CROSS_TREE : 1);
    const why = cross ? tr(` (stat de outra árvore: combinação pouco óbvia)`, ` (stat from another tree: a non-obvious combo)`) : "";
    push(`feed:${stat}`, score, tr(`${a.name} dá ${STAT_LABEL[stat]}${when === "conditional" ? " (condicional)" : ""}; ${b.name} escala com isso${why}`, `${a.name} gives ${STAT_LABEL[stat]}${when === "conditional" ? " (conditional)" : ""}; ${b.name} scales with it${why}`));
  }

  // 2. A causa dano de spirit e B dispara ao causar dano de spirit.
  if (b.triggers.includes("onSpiritDamage") && dealsAny(a, ["spirit", "spiritDot"])) {
    const frequent = a.deals.includes("spiritDot") || a.triggers.includes("onBullet");
    push("trigger:spiritDamage", frequent ? 1.5 : 1, tr(`${a.name} causa dano de spirit${frequent ? " com frequência" : ""}; isso dispara ${b.name}`, `${a.name} deals spirit damage${frequent ? " frequently" : ""}; that triggers ${b.name}`));
  }

  // 3. A é uma habilidade que causa dano e B dispara quando habilidades causam dano.
  if (b.triggers.includes("onAbilityHit") && a.kind === "ability" && a.deals.length > 0) {
    push("trigger:abilityHit", 1, tr(`${a.name} causa dano de habilidade; isso dispara ${b.name}`, `${a.name} deals ability damage; that triggers ${b.name}`));
  }

  // 4. A reduz a resistência que protege o inimigo do dano de B.
  // Na mesma árvore é o esperado (item de arma que reduz resistência a bala com outro
  // item de arma); entre árvores é o que o jogador não vê sozinho.
  const sameTree = a.kind === "item" && b.kind === "item" && a.slot === b.slot;
  const shredScore = sameTree ? 0.5 : 1.2;
  if (a.applies.includes("spiritShred") && dealsAny(b, SPIRIT)) push("shred:spirit", shredScore, tr(`${a.name} reduz resistência a spirit; ${b.name} causa dano de spirit`, `${a.name} reduces spirit resist; ${b.name} deals spirit damage`));
  if (a.applies.includes("bulletShred") && dealsAny(b, PHYSICAL)) push("shred:bullet", shredScore, tr(`${a.name} reduz resistência a bala; ${b.name} causa dano de arma`, `${a.name} reduces bullet resist; ${b.name} deals weapon damage`));
  if (a.applies.includes("damageTaken") && b.deals.length > 0) push("amp:damageTaken", 0.8, tr(`${a.name} faz o alvo receber mais dano; ${b.name} causa dano`, `${a.name} makes the target take more damage; ${b.name} deals damage`));

  // 5. Lifesteal de A é alimentado pelo dano de B.
  if (a.gives.spiritLifesteal && dealsAny(b, ["spirit", "spiritDot"])) push("lifesteal:spirit", 0.8, tr(`${a.name} dá lifesteal de spirit; ${b.name} causa dano de spirit`, `${a.name} gives spirit lifesteal; ${b.name} deals spirit damage`));
  if (a.gives.bulletLifesteal && b.deals.includes("weapon")) push("lifesteal:bullet", 0.8, tr(`${a.name} dá lifesteal de bala; ${b.name} causa dano de arma`, `${a.name} gives bullet lifesteal; ${b.name} deals weapon damage`));

  // 6. A cura e B dispara ao curar.
  if (b.triggers.includes("onHeal") && a.gives.healing && a.kind !== "weapon") push("trigger:heal", 1, tr(`${a.name} cura; isso dispara ${b.name}`, `${a.name} heals; that triggers ${b.name}`));

  // 7. A arma dispara efeitos "por bala" de itens; armas com mais balas por segundo disparam mais.
  if (a.kind === "weapon" && b.kind === "item" && b.triggers.includes("onBullet")) {
    const rate = a.hitsPerSecond ?? 0;
    const score = Math.min(1.5, Math.max(0.3, rate / 8));
    push("trigger:bullet", score, tr(`${a.name} acerta ${rate.toFixed(1)} balas/s; isso dispara ${b.name}`, `${a.name} lands ${rate.toFixed(1)} bullets/s; that triggers ${b.name}`));
  }

  // 8. Controle de A facilita acertar o gatilho de B.
  const aimed = b.triggers.some((t) => t === "onHeadshot" || t === "onMelee" || t === "closeRange");
  if (a.applies.includes("stun") && aimed) {
    push("setup:stun", 0.5, tr(`${a.name} imobiliza o alvo; isso facilita o gatilho de ${b.name}`, `${a.name} immobilizes the target; that makes ${b.name} easier to trigger`));
  } else if (a.applies.includes("slow") && aimed) {
    push("setup:slow", 0.3, tr(`${a.name} deixa o alvo lento; isso facilita o gatilho de ${b.name}`, `${a.name} slows the target; that makes ${b.name} easier to trigger`));
  }

  // As regras abaixo ligam sobretudo itens de árvores diferentes: um dá o meio
  // (vida, mobilidade, amplificação) e o outro tem o efeito que precisa dele.

  // 9. A amplifica todo dano causado, e B causa dano.
  if (a.gives.damageAmp && b.deals.length > 0) {
    const conditional = a.gives.damageAmp === "conditional";
    push("amp:damage", conditional ? 0.5 : 0.8, tr(`${a.name} aumenta o dano causado${conditional ? " (condicional)" : ""}; ${b.name} causa dano`, `${a.name} amplifies damage dealt${conditional ? " (conditional)" : ""}; ${b.name} deals damage`));
  }

  // 10. A dá defesa, e o gatilho de B pede ficar perto do inimigo ou com pouca vida.
  const frontline = b.triggers.find((t) => t === "closeRange" || t === "onMelee" || t === "lowHealth");
  const defense = (["health", "barrier", "bulletResist", "spiritResist"] as Stat[]).find((s) => a.gives[s] === "always");
  if (frontline && defense) {
    // Genérico (qualquer defesa ajuda quem luta de perto): pista fraca.
    push("enable:frontline", 0.15, tr(`${a.name} dá ${STAT_LABEL[defense]}; ajuda a sobreviver no gatilho de ${b.name} (${TRIGGER_LABEL[frontline]})`, `${a.name} gives ${STAT_LABEL[defense]}; helps you survive while triggering ${b.name} (${TRIGGER_LABEL[frontline]})`));
  }

  // 11. A recupera vida, e B só funciona com a vida alta.
  const recovery = (["healing", "regen", "bulletLifesteal", "spiritLifesteal"] as Stat[]).find((s) => a.gives[s]);
  if (recovery && b.triggers.includes("highHealth")) {
    push("sustain:highHealth", 0.5, tr(`${a.name} dá ${STAT_LABEL[recovery]}; isso mantém a vida alta, condição de ${b.name}`, `${a.name} gives ${STAT_LABEL[recovery]}; that keeps health high, which ${b.name} needs`));
  }

  // 12. A dá mobilidade, e B pede chegar perto ou se mover.
  const approach = b.triggers.find((t) => t === "closeRange" || t === "onMelee" || t === "onMovement");
  const mobility = (["moveSpeed", "stamina"] as Stat[]).find((s) => a.gives[s] === "always");
  if (approach && mobility) {
    push("enable:mobility", 0.2, tr(`${a.name} dá ${STAT_LABEL[mobility]}; ajuda a cumprir o gatilho de ${b.name} (${TRIGGER_LABEL[approach]})`, `${a.name} gives ${STAT_LABEL[mobility]}; helps meet the trigger of ${b.name} (${TRIGGER_LABEL[approach]})`));
  }

  return out;
}

/** Sinergias simétricas: os dois efeitos disparam na mesma ação. */
export function sharedLinks(a: Node, b: Node): Link[] {
  if (a.id === b.id) return [];
  const kit = a.kind !== "item" ? a : b.kind !== "item" ? b : null;
  const item = kit === a ? b : a;
  return SHARED_TRIGGERS.filter((t) => a.triggers.includes(t) && b.triggers.includes(t)).map((t) => ({
    from: a.id,
    to: b.id,
    rule: kit ? `kit:${t}` : `shared:${t}`,
    score: kit && item.kind === "item" ? SHARED_KIT : SHARED_ITEMS,
    reason: kit
      ? tr(`${kit.name} já leva você a agir ${TRIGGER_LABEL[t]}; ${item.name} dispara na mesma ação`, `${kit.name} already has you acting ${TRIGGER_LABEL[t]}; ${item.name} triggers on the same action`)
      : tr(`${a.name} e ${b.name} pedem a mesma condição (${TRIGGER_LABEL[t]}): reforçam um ao outro, mas não abrem nada novo`, `${a.name} and ${b.name} need the same condition (${TRIGGER_LABEL[t]}): they reinforce each other but unlock nothing new`),
  }));
}

/** Todas as sinergias entre dois nós, nas duas direções. */
export function linksBetween(a: Node, b: Node): Link[] {
  return [...linksFrom(a, b), ...linksFrom(b, a), ...sharedLinks(a, b)];
}

export interface Scored {
  score: number;
  links: Link[];
}

const total = (links: Link[]) => links.reduce((sum, l) => sum + l.score, 0);
const byScore = <T extends Scored>(a: T, b: T) => b.score - a.score;

export interface Graph {
  data: GameData;
  tagged: TaggedData;
  itemNode: Map<string, Node>;
  /** Interações conhecidas (wiki), indexadas pelo par de ids. */
  known: Map<string, Interaction[]>;
}

export function buildGraph(data: GameData): Graph {
  const tagged = tagAll(data);
  const known = new Map<string, Interaction[]>();
  for (const i of data.knowledge ?? []) {
    const key = pairKey(i.a, i.b);
    known.set(key, [...(known.get(key) ?? []), i]);
  }
  return { data, tagged, itemNode: new Map(tagged.items.map((n) => [n.id, n])), known };
}

/** Sinergias entre dois nós do grafo: regras + interações conhecidas da wiki. */
function allLinks(graph: Graph, a: Node, b: Node): Link[] {
  return [...linksBetween(a, b), ...knownLinks(graph, a.id, b.id)];
}

function kitOf(graph: Graph, hero: Hero): Node[] {
  return graph.tagged.kits.get(hero.id) ?? [];
}

function nodeOf(graph: Graph, item: Item): Node {
  const node = graph.itemNode.get(item.className);
  if (!node) throw new Error(tr(`Item sem etiquetas: ${item.name}`, `Item without tags: ${item.name}`));
  return node;
}

/** Uso de melee a partir do qual itens de melee passam a valer para o herói. */
const MELEE_NEUTRAL = 0.3;

/**
 * Como o herói é jogado de fato (estatísticas de partidas). Hoje: o quanto ele usa
 * melee, que decide se itens "ao acertar melee" valem a pena; sem estatísticas, nada.
 */
function metaLinks(graph: Graph, hero: Hero, node: Node): Link[] {
  if (!node.triggers.includes("onMelee") || !graph.data.stats) return [];
  const share = meleeShare(graph.data, hero.id);
  const rate = meleePickRate(graph.data, hero.id) ?? 0;
  const score = Math.max(-0.5, 2 * (share - MELEE_NEUTRAL));
  const reason =
    score > 0
      ? tr(`jogadores de ${hero.name} usam muito corpo a corpo (compram itens de melee em ${Math.round(rate * 100)}% das partidas); ${node.name} dispara no melee`, `${hero.name} players melee a lot (they buy melee items in ${Math.round(rate * 100)}% of matches); ${node.name} triggers on melee`)
      : tr(`jogadores de ${hero.name} quase não usam corpo a corpo (itens de melee em ${Math.round(rate * 100)}% das partidas); ${node.name} depende disso`, `${hero.name} players rarely melee (melee items in ${Math.round(rate * 100)}% of matches); ${node.name} depends on it`);
  return [{ from: `meta:${hero.id}`, to: node.id, rule: "meta:melee", score, reason }];
}

/** Quanto vale cada repetição da mesma regra depois da primeira (com outra habilidade do kit). */
const REPEAT = 0.3;

/**
 * Nota de encaixe no kit: cada regra conta inteira uma vez e as repetições valem
 * 30%. Assim, um item que reduz resistência a spirit não ganha 4x só porque o kit
 * tem 4 habilidades de spirit, e motivos diferentes pesam mais que o mesmo motivo
 * repetido.
 */
function kitScore(links: Link[]): number {
  const byRule = new Map<string, number[]>();
  for (const l of links) byRule.set(l.rule, [...(byRule.get(l.rule) ?? []), l.score]);
  let sum = 0;
  for (const scores of byRule.values()) {
    scores.sort((a, b) => b - a);
    sum += scores[0]! + REPEAT * scores.slice(1).reduce((s, v) => s + v, 0);
  }
  return sum;
}

/** Peso de uma teoria da comunidade: cresce com as builds que a citam; os dados de partidas confirmam ou cortam. */
const THEORY_BASE = 0.6;
const THEORY_PER_BUILD = 0.25;
const THEORY_MAX_BUILDS = 4;
const THEORY_VERDICT = { supported: 1.4, unclear: 0.8, contradicted: 0 } as const;

/** Teorias de combo e arquétipo do herói que incluem o item. */
function theoryLinks(graph: Graph, hero: Hero, node: Node): Link[] {
  return (graph.data.theories ?? [])
    .filter((t) => t.heroId === hero.id && (t.kind === "combo" || t.kind === "archetype") && t.items.includes(node.id))
    .map((t) => {
      const verdict = t.evidence?.verdict ?? "unclear";
      const support = THEORY_BASE + THEORY_PER_BUILD * Math.min(THEORY_MAX_BUILDS, t.builds.length - 1);
      const data =
        t.evidence?.verdict === "supported"
          ? tr(`; nas partidas, juntos ganham ${t.evidence.lift.toFixed(1)} pp a mais`, `; in matches, together they win ${t.evidence.lift.toFixed(1)} pp more`)
          : t.evidence?.verdict === "contradicted"
            ? tr(`; nas partidas, juntos ganham menos`, `; in matches, together they win less`)
            : "";
      return {
        from: `theory:${hero.id}`,
        to: node.id,
        rule: `theory:${t.kind}`,
        score: support * THEORY_VERDICT[verdict],
        reason: `${trData(t.title)}: ${trData(t.claim)} (${t.builds.length} ${t.builds.length === 1 ? tr("build publicada", "published build") : tr("builds publicadas", "published builds")}${data})`,
      };
    })
    .filter((l) => l.score > 0);
}

/** O quanto um item combina com o kit de um herói (e com como ele é jogado). */
export function heroItemFit(graph: Graph, hero: Hero, item: Item): Scored {
  const node = nodeOf(graph, item);
  const links = [
    ...kitOf(graph, hero).flatMap((k) => allLinks(graph, node, k)),
    ...knownLinks(graph, node.id, `hero:${hero.id}`),
    ...metaLinks(graph, hero, node),
    ...theoryLinks(graph, hero, node),
  ];
  return { score: kitScore(links), links };
}

export interface ItemFit extends Scored {
  item: Item;
}

/** Itens ordenados pelo encaixe no kit do herói. */
export function itemsForHero(graph: Graph, hero: Hero): ItemFit[] {
  return graph.data.items
    .map((item) => ({ item, ...heroItemFit(graph, hero, item) }))
    .filter((f) => f.score > 0)
    .sort(byScore);
}

export interface HeroFit extends Scored {
  hero: Hero;
}

/** Heróis ordenados pelo quanto aproveitam um item. */
export function heroesForItem(graph: Graph, item: Item): HeroFit[] {
  return graph.data.heroes
    .map((hero) => ({ hero, ...heroItemFit(graph, hero, item) }))
    .filter((f) => f.score > 0)
    .sort(byScore);
}

export interface Partner extends Scored {
  item: Item;
}

/** Nota mínima para listar um parceiro: abaixo disso só há pistas genéricas (ex.: "defesa ajuda a lutar de perto"). */
const MIN_PARTNER = 0.3;

/** Itens que têm sinergia direta com o item dado. */
export function partnersForItem(graph: Graph, item: Item): Partner[] {
  const node = nodeOf(graph, item);
  return graph.data.items
    .filter((other) => other.className !== item.className)
    .map((other) => {
      const links = allLinks(graph, node, nodeOf(graph, other));
      return { item: other, score: total(links), links };
    })
    .filter((p) => p.score >= MIN_PARTNER)
    .sort(byScore);
}

/**
 * Parceiros separados por árvore da loja, os melhores de cada uma. Assim os
 * parceiros de outras árvores aparecem mesmo quando os da mesma árvore têm
 * pontuação maior (itens da mesma árvore tendem a compartilhar etiquetas).
 */
export function partnersByTree(graph: Graph, item: Item, perTree = 5): Record<Item["slot"], Partner[]> {
  const all = partnersForItem(graph, item);
  const pick = (slot: Item["slot"]) => all.filter((p) => p.item.slot === slot).slice(0, perTree);
  return { weapon: pick("weapon"), vitality: pick("vitality"), spirit: pick("spirit") };
}

export interface PairFit {
  hero: Hero;
  /** Sinergia entre os dois itens (igual para todo herói). */
  pair: Scored;
  a: Scored;
  b: Scored;
  score: number;
}

/**
 * Heróis em que o par de itens funciona: os dois itens precisam encaixar no
 * kit (usa o menor dos dois encaixes) e a sinergia do par soma por cima.
 */
export function heroesForPair(graph: Graph, itemA: Item, itemB: Item): PairFit[] {
  const pairLinks = allLinks(graph, nodeOf(graph, itemA), nodeOf(graph, itemB));
  const pair = { score: total(pairLinks), links: pairLinks };
  return graph.data.heroes
    .map((hero) => {
      const a = heroItemFit(graph, hero, itemA);
      const b = heroItemFit(graph, hero, itemB);
      return { hero, pair, a, b, score: Math.min(a.score, b.score) + pair.score };
    })
    .filter((f) => f.a.score > 0 && f.b.score > 0)
    .sort((x, y) => y.score - x.score);
}

/** Junta links repetidos pela mesma regra e devolve os mais fortes (só os positivos). */
export function topLinks(links: Link[], limit = 3): Link[] {
  const best = new Map<string, Link>();
  for (const link of links) {
    if (link.score <= 0) continue; // penalidades pesam na nota, mas não são motivo para sugerir
    const key = `${link.rule}|${link.from}|${link.to}`;
    const current = best.get(key);
    if (!current || link.score > current.score) best.set(key, link);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Os motivos mais fortes, em texto. */
export function topReasons(links: Link[], limit = 3): string[] {
  return topLinks(links, limit).map((l) => l.reason);
}

/** Sinergias entre dois itens, com as interações conhecidas da wiki. */
export function itemPairLinks(graph: Graph, a: Item, b: Item): Link[] {
  return allLinks(graph, nodeOf(graph, a), nodeOf(graph, b));
}
