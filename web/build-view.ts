import type { Ability, Item } from "../src/data/types.ts";
import { badgeName, ELITE_PATH_MIN_RATE, eliteAbilityOrder, eliteMaxFirst, heroElite } from "../src/meta/elite.ts";
import type { ItemWpa } from "../src/meta/wpa.ts";
import { componentTree, heroAbilities, findHero, progressionFromSouls, MAX_ACTIVE_ITEMS } from "../src/engine/index.ts";
import { heroItemFit, itemPairLinks, topLinks, type Link } from "../src/interactions/synergy.ts";
import type { Metrics } from "../src/optimizer/metrics.ts";
import { archetypeWeights } from "../src/optimizer/archetype.ts";
import type { UiObjective } from "./main.ts";
import type { BuildComparison } from "../src/meta/compare.ts";
import { buyMinute, heroMeta, meleePickRate, pickRate, powerWindows, vitalitySpikeOf } from "../src/meta/stats.ts";
import { VITALITY_SPIKE_SOULS } from "../src/engine/rules.ts";
import type { OptimizeInput, OptimizeResult } from "../src/optimizer/optimize.ts";
import { CONTROL_LABEL, CONTROL_MIN_PER_MINUTE, heroControl } from "../src/optimizer/control.ts";
import { defenseOf } from "../src/optimizer/defense.ts";
import type { Theory, TheoryKind } from "../src/knowledge/theories.ts";
import { controlBreakdown, DEFAULT_METRIC_OPTIONS } from "../src/optimizer/metrics.ts";
import { delta, fmt, fmt1, h, icon } from "./dom.ts";
import type { App } from "./main.ts";
import { abilityIcon, itemIcon, withItemTip } from "./tooltip.ts";
import type { Recommendation } from "../src/combat/explain.ts";
import { SCENARIO_LABEL, scenarioMix, type ScenarioId } from "../src/combat/value.ts";
import { phaseLabel, phaseOf } from "../src/optimizer/route.ts";
import { inputKey } from "./build-client.ts";
import type { BuildPayload } from "./compute.ts";
import { tr, trData, locale } from "../src/i18n.ts";

/** Nome e dica de cada objetivo, no idioma em uso (função: o idioma é definido depois do carregamento do módulo). */
const objectiveLabel = (): Record<UiObjective, { name: string; hint: string }> => ({
  optimized: { name: tr("Otimizada", "Optimized"), hint: tr("dano máximo somando arma e spirit, com sobrevivência das builds mais jogadas", "max damage from weapon plus spirit, with the survival of the most played builds") },
  weapon: { name: tr("Arma", "Weapon"), hint: tr("tiros e efeitos disparados por bala", "shots and on-bullet effects") },
  spirit: { name: "Spirit", hint: tr("habilidades e dano de spirit de itens", "abilities and spirit damage from items") },
  survival: { name: tr("Tanque/Sustain", "Tank/Sustain"), hint: tr("vida efetiva mais a cura ao longo de uma luta", "effective HP plus healing over a fight") },
  control: { name: tr("Controle", "Control"), hint: tr("stun, silêncio e lentidão, com dano e a defesa da Otimizada", "stun, silence and slow, with the damage and defense of Optimized") },
  archetype: { name: tr("Padrão do arquétipo", "Archetype default"), hint: tr("mantém a natureza do arquétipo escolhido: arma, spirit e vida no peso que os itens dele dão ao herói", "keeps the nature of the chosen archetype: weapon, spirit and HP weighted as its items boost the hero") },
});

/** Objetivos oferecidos no seletor, na ordem. */
const SHOWN_OBJECTIVES: UiObjective[] = ["optimized", "weapon", "spirit", "survival", "control", "archetype"];

const slotLabel = () => ({ weapon: tr("Arma", "Weapon"), vitality: tr("Vitalidade", "Vitality"), spirit: "Spirit" }) as const;
/** A build é sempre a de fim de partida: souls e slots fixos. */
const SOULS = 50_000;
const SLOTS = 12;
/** Efeitos condicionais sem duração/cooldown na API valem metade do tempo. */
const UPTIME = DEFAULT_METRIC_OPTIONS.uptime;

/** Motivos de um item estar na build: encaixe no kit (e como o herói é jogado) e sinergia com os outros itens. */
function reasonsFor(app: App, item: Item, heroId: number, others: Item[]): Link[] {
  if (!app.graph.itemNode.has(item.className)) return [];
  const hero = app.data.heroes.find((h) => h.id === heroId)!;
  const withItems = others.filter((o) => app.graph.itemNode.has(o.className)).flatMap((o) => itemPairLinks(app.graph, item, o));
  const withKit = heroItemFit(app.graph, hero, item).links;
  // Uma sinergia com outro item da build vem primeiro: é o que o usuário não vê sozinho.
  return [...topLinks(withItems, 1), ...topLinks(withKit, 2)].slice(0, 2);
}

/** Um motivo na lista; quando vem da wiki, com o link da página. */
export function reasonItem(link: Link | string): HTMLElement {
  if (typeof link === "string") return h("li", {}, link);
  return h("li", {}, link.reason, link.source ? [" ", h("a", { href: link.source, target: "_blank", rel: "noopener" }, tr("fonte", "source"))] : null);
}

/** Arquétipo escolhido para o herói atual, se houver. */
function selectedArchetype(app: App): Theory | null {
  const heroId = findHero(app.data, app.state.hero).id;
  return heroArchetypes(app, heroId).find((a) => a.theory.title === app.state.archetype)?.theory ?? null;
}

/**
 * Objetivo em uso: "Controle" volta para "Otimizada" em herói quase sem controle no kit,
 * e "Padrão do arquétipo" sem arquétipo escolhido também.
 */
function objectiveFor(app: App): UiObjective {
  const { state, data } = app;
  if (state.objective === "control" && heroControl(data, state.hero) < CONTROL_MIN_PER_MINUTE) return "optimized";
  if (state.objective === "archetype" && !selectedArchetype(app)) return "optimized";
  return state.objective;
}

/** Objetivo de um pedido ao otimizador, de volta ao id da tela (pesos próprios = arquétipo). */
const objectiveOf = (input: OptimizeInput): UiObjective => (typeof input.objective === "string" ? (input.objective as UiObjective) : "archetype");

function controls(app: App): HTMLElement {
  const { state, data } = app;
  const heroes = h(
    "div",
    { class: "hero-grid", role: "radiogroup", "aria-label": tr("Herói", "Hero") },
    data.heroes.map((hero) =>
      h(
        "button",
        {
          class: "hero",
          role: "radio",
          "aria-checked": String(hero.name === state.hero),
          title: hero.name,
          "aria-label": hero.name,
          onclick: () => app.update({ hero: hero.name, archetype: "", required: [], banned: [] }),
        },
        icon(hero.image, hero.name, "portrait"),
      ),
    ),
  );

  const objectives = h(
    "div",
    { class: "objectives", role: "radiogroup", "aria-label": tr("Objetivo", "Goal") },
    SHOWN_OBJECTIVES.map((id) => {
      const kit = id === "control" ? heroControl(data, state.hero) : Infinity;
      const noKit = kit < CONTROL_MIN_PER_MINUTE;
      const noArchetype = id === "archetype" && !selectedArchetype(app);
      const off = noKit || noArchetype;
      const why = noKit
        ? tr(`${state.hero} tem pouco controle no kit (${fmt1(kit)} s/min)`, `${state.hero} has little control in the kit (${fmt1(kit)} s/min)`)
        : tr("Escolha um arquétipo acima", "Pick an archetype above");
      const label = objectiveLabel()[id];
      return h(
        "button",
        {
          class: "objective",
          role: "radio",
          "aria-checked": String(id === objectiveFor(app)),
          ...(off ? { disabled: true, title: why } : {}),
          onclick: () => app.update({ objective: id }),
        },
        h("strong", {}, label.name),
        h(
          "span",
          {},
          noKit
            ? tr(`${state.hero} quase não tem controle no kit`, `${state.hero} has almost no control in the kit`)
            : noArchetype
              ? tr("escolha um arquétipo acima", "pick an archetype above")
              : label.hint,
        ),
      );
    }),
  );

  const heroId = findHero(data, state.hero).id;
  const spike = vitalitySpikeOf(data, heroId, VITALITY_SPIKE_SOULS);
  const level = progressionFromSouls(data.shared, SOULS).level;
  const match = h(
    "ul",
    { class: "fixed" },
    h("li", {}, tr(`${fmt(SOULS)} souls (nível ${level}) e ${SLOTS} slots de item: a build de fim de partida.`, `${fmt(SOULS)} souls (level ${level}) and ${SLOTS} item slots: the late-game build.`)),
    h(
      "li",
      {},
      tr(
        `Efeitos condicionais: ativos e procs valem pela duração ÷ cooldown do item; condições sem esses números (como “acima de 65% de vida”) valem ${Math.round(UPTIME * 100)}% do tempo.`,
        `Conditional effects: actives and procs count by the item's duration ÷ cooldown; conditions without those numbers (like “above 65% health”) count ${Math.round(UPTIME * 100)}% of the time.`,
      ),
    ),
    h(
      "li",
      {},
      spike
        ? tr(
            `Pico de vitality (${fmt(VITALITY_SPIKE_SOULS)} souls em vitality) até ${fmt(spike.souls)} souls, por volta do minuto ${Math.round(spike.minute)}: a média dos jogadores de ${state.hero}.`,
            `Vitality spike (${fmt(VITALITY_SPIKE_SOULS)} souls in vitality) by ${fmt(spike.souls)} souls, around minute ${Math.round(spike.minute)}: the average for ${state.hero} players.`,
          )
        : tr(
            `Pico de vitality sem prazo: na média, os jogadores de ${state.hero} não chegam a ${fmt(VITALITY_SPIKE_SOULS)} souls em vitality.`,
            `Vitality spike with no deadline: on average, ${state.hero} players don't reach ${fmt(VITALITY_SPIKE_SOULS)} souls in vitality.`,
          ),
    ),
  );

  const fp = app.data.fights;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const fightInfo = fp
    ? h(
        "p",
        { class: "hint" },
        tr(
          `Medido em ${fp.matches.toLocaleString(locale())} partidas: o alvo morre em ${fp.timeToKill.median.toLocaleString(locale())} s (mediana) depois do primeiro dano. `,
          `Measured in ${fp.matches.toLocaleString(locale())} matches: the target dies ${fp.timeToKill.median.toLocaleString(locale())} s (median) after the first damage. `,
        ),
        tr(
          `Das mortes, ${pct(fp.sizes.duel)} são em lutas de 2 heróis, ${pct(fp.sizes.skirmish)} de 3 a 5 e ${pct(fp.sizes.teamfight)} de 6 ou mais. `,
          `Of the deaths, ${pct(fp.sizes.duel)} are in fights of 2 heroes, ${pct(fp.sizes.skirmish)} of 3 to 5 and ${pct(fp.sizes.teamfight)} of 6 or more. `,
        ),
        tr(`Perseguição e iniciação inimiga não aparecem nos dados e têm peso fixo.`, `Chases and enemy engages don't show up in the data and have a fixed weight.`),
      )
    : h(
        "p",
        { class: "hint" },
        tr(
          "Sem dados de lutas das partidas: usa uma luta de 10 s e uma mistura de tipos de luta escolhida pelo projeto.",
          "No fight data from matches: uses a 10 s fight and a mix of fight types chosen by the project.",
        ),
      );

  const progressive = h(
    "label",
    { class: "check" },
    h("input", { type: "checkbox", checked: state.progressive, onchange: (ev) => app.update({ progressive: (ev.target as HTMLInputElement).checked }) }),
    tr(" Montar compra a compra, como na partida", " Build purchase by purchase, like in a match"),
  );

  return h(
    "aside",
    { class: "controls", "aria-label": tr("Configuração da build", "Build settings") },
    h("section", {}, h("h2", {}, tr("Herói", "Hero")), heroes),
    archetypeSection(app, heroId),
    h("section", {}, h("h2", {}, tr("Objetivo", "Goal")), objectives),
    h("section", {}, h("h2", {}, tr("Partida", "Match")), match),
    h("section", {}, h("h2", {}, tr("Lutas", "Fights")), fightInfo),
    h(
      "section",
      {},
      h("h2", {}, tr("Ordem de compra", "Purchase order")),
      progressive,
      h(
        "p",
        { class: "hint" },
        tr(
          "Cada compra é a de maior ganho entre as que o herói já consegue pagar. Itens de 1.600, 3.200 e 6.400 só entram a partir dos souls em que os jogadores desse herói costumam comprá-los. Desmarcado, mostra a build mais forte para os souls finais, que nem sempre dá para montar na partida.",
          "Each purchase is the biggest gain among those the hero can already afford. 1,600, 3,200 and 6,400 items only come in from the souls at which this hero's players usually buy them. Unchecked, it shows the strongest build for the final souls, which can't always be assembled in a match.",
        ),
      ),
    ),
  );
}

/** Arquétipos da comunidade para o herói, com a fatia das partidas de cada um entre eles. */
function heroArchetypes(app: App, heroId: number): { theory: Theory; share: number | null }[] {
  const list = (app.data.theories ?? [])
    .filter((t) => t.heroId === heroId && t.kind === "archetype" && t.evidence?.verdict !== "contradicted")
    .sort((a, b) => (b.evidence?.matches ?? 0) - (a.evidence?.matches ?? 0) || b.builds.length - a.builds.length);
  const total = list.reduce((sum, t) => sum + (t.evidence?.matches ?? 0), 0);
  return list.map((theory) => ({ theory, share: total > 0 && theory.evidence?.matches ? theory.evidence.matches / total : null }));
}

/** Seletor de arquétipo: fixa os itens que definem o estilo e deixa o resto com o otimizador. */
function archetypeSection(app: App, heroId: number): HTMLElement | null {
  const list = heroArchetypes(app, heroId);
  if (!list.length) return null;
  const current = list.find((a) => a.theory.title === app.state.archetype)?.theory ?? null;
  const option = (label: string, meta: string, checked: boolean, pick: () => void, title?: string) =>
    h(
      "button",
      { class: "objective archetype", role: "radio", "aria-checked": String(checked), ...(title ? { title } : {}), onclick: pick },
      h("strong", {}, label),
      h("span", {}, meta),
    );
  return h(
    "section",
    {},
    h("h2", {}, tr("Arquétipo", "Archetype")),
    h(
      "div",
      { class: "objectives", role: "radiogroup", "aria-label": tr("Arquétipo", "Archetype") },
      option(tr("Livre", "Free"), tr("o otimizador escolhe todos os itens", "the optimizer picks every item"), current === null, () => app.update({ archetype: "", required: [] })),
      list.map(({ theory, share }) =>
        option(
          trData(theory.title),
          share === null ? tr("sem partidas medidas", "no measured matches") : tr(`${Math.round(share * 100)}% de popularidade`, `${Math.round(share * 100)}% popularity`),
          theory === current,
          () => app.update({ archetype: theory.title, required: archetypeCore(app, theory) }),
          trData(theory.claim),
        ),
      ),
    ),
    h(
      "p",
      { class: "hint" },
      current
        ? tr(`${current.claim} Fixa ${archetypeCore(app, current).join(", ")}.`, `${trData(current.claim)} Locks ${archetypeCore(app, current).join(", ")}.`)
        : tr(
            "Popularidade: partidas do herói com todos os itens do arquétipo, como fatia da soma entre os arquétipos (uma partida pode entrar em mais de um).",
            "Popularity: the hero's matches with every item of the archetype, as a share of the total across archetypes (a match can count in more than one).",
          ),
    ),
  );
}

/** Trilha de souls: cada compra ocupa uma fatia proporcional ao custo. */
function soulTrack(app: App, result: OptimizeResult): HTMLElement {
  const total = Math.max(result.souls, 1);
  const segments = result.order.map((step, i) =>
    withItemTip(app, step.item, h(
      "li",
      {
        class: `seg seg-${step.item.slot}`,
        style: `flex-grow:${step.cost}`,
        "aria-label": tr(`${i + 1}. ${step.item.name}: ${fmt(step.cost)} souls (acumulado ${fmt(step.spent)})`, `${i + 1}. ${step.item.name}: ${fmt(step.cost)} souls (total ${fmt(step.spent)})`),
        "data-step": i,
      },
      icon(step.item.image, step.item.name, "seg-icon"),
    )),
  );
  const left = result.souls - result.spent;
  if (left > 0) segments.push(h("li", { class: "seg seg-left", style: `flex-grow:${left}`, title: tr(`${fmt(left)} souls sem uso`, `${fmt(left)} souls unused`) }));

  const ticks = [];
  for (let s = 5000; s < total; s += 5000) ticks.push(h("span", { class: "tick", style: `left:${(s / total) * 100}%` }, `${s / 1000}k`));

  // Marcos do pico de vitality: o prazo (começo do mid game) e o ponto em que a build chega lá.
  const v = result.vitality;
  const marks = [];
  // Na metade direita da trilha, o rótulo fica à esquerda da linha para não sair da tela.
  const mark = (kind: string, at: number, label: string) => {
    const pos = (at / total) * 100;
    return h("span", { class: `mark mark-${kind}${pos > 50 ? " mark-end" : ""}`, style: `left:${pos}%` }, label);
  };
  if (v && v.reachedAt !== null) marks.push(mark("spike", v.reachedAt, tr("4,8k vitality", "4.8k vitality")));
  if (v && v.deadline < total) marks.push(mark("deadline", v.deadline, tr(`média do herói, ~${Math.round(v.deadlineMinute)} min`, `hero average, ~${Math.round(v.deadlineMinute)} min`)));
  let spikeText = "";
  if (v) {
    if (v.reachedAt !== null)
      spikeText = tr(
        ` O pico de vitality vem com ${fmt(v.reachedAt)} souls gastos, por volta do minuto ${Math.round(v.reachedMinute ?? 0)}${v.enforced && !v.ok ? ", depois do prazo" : ""}.`,
        ` The vitality spike comes at ${fmt(v.reachedAt)} souls spent, around minute ${Math.round(v.reachedMinute ?? 0)}${v.enforced && !v.ok ? ", after the deadline" : ""}.`,
      );
    else if (!v.enforced)
      spikeText = tr(` Vitality: ${fmt(v.invested)} de 4.800 souls; o prazo do pico é ${fmt(v.deadline)} souls.`, ` Vitality: ${fmt(v.invested)} of 4,800 souls; the spike deadline is ${fmt(v.deadline)} souls.`);
    else spikeText = tr(" A build não chega ao pico de vitality: os itens fixados ou os slots não deixam.", " The build doesn't reach the vitality spike: the locked items or the slots don't allow it.");
  }

  return h(
    "figure",
    { class: "track" },
    h("ol", { class: "track-bar", "aria-label": tr("Compras na ordem, proporcionais ao custo", "Purchases in order, proportional to cost") }, segments),
    h("div", { class: "track-ticks", "aria-hidden": "true" }, ticks, marks),
    h(
      "figcaption",
      {},
      tr(
        `${fmt(result.spent)} de ${fmt(result.souls)} souls gastos. A largura de cada fatia é o preço da compra.${spikeText}`,
        `${fmt(result.spent)} of ${fmt(result.souls)} souls spent. Each slice's width is the purchase price.${spikeText}`,
      ),
    ),
  );
}

const SLOT_ORDER = { weapon: 0, vitality: 1, spirit: 2 } as const;

/**
 * Inventário no fim da partida: o que sobra depois das vendas e com os componentes
 * já absorvidos pelos upgrades. Mostra todos os slots liberados, inclusive os vazios.
 */
const theoryGroups = (): { kind: TheoryKind; title: string; hint: string }[] => [
  { kind: "combo", title: "Combos", hint: tr("Itens que os autores juntam, e por quê.", "Items the authors pair, and why.") },
  { kind: "timing", title: tr("Prioridades", "Priorities"), hint: tr("O que comprar cedo ou tarde.", "What to buy early or late.") },
  { kind: "late-swap", title: tr("Trocas de fim de jogo", "Late-game swaps"), hint: tr("O que vender, e o que entra no lugar.", "What to sell, and what replaces it.") },
  { kind: "situational", title: tr("Situacionais", "Situational"), hint: tr("Respostas a situações da partida.", "Answers to match situations.") },
];
const verdictLabel = () =>
  ({
    supported: tr("confirmada pelos dados", "supported by the data"),
    unclear: tr("sem conclusão nos dados", "inconclusive in the data"),
    contradicted: tr("os dados discordam", "the data disagrees"),
  }) as const;
/** Teorias mostradas por grupo (as com mais builds primeiro). */
const THEORIES_PER_GROUP = 5;

/**
 * Itens a fixar para montar a partir de um arquétipo: só o topo de cada cadeia de
 * upgrade (com Melee Charge e Crushing Fists na lista, fixa só Crushing Fists; fixar
 * o componente impediria o upgrade). No máximo 6, para sobrar espaço ao otimizador.
 */
function archetypeCore(app: App, t: Theory): string[] {
  const items = t.items.map((c) => app.data.items.find((i) => i.className === c)).filter((i) => i !== undefined);
  return items.filter((i) => !items.some((o) => o !== i && componentTree(app.data, o).has(i.className))).slice(0, 6).map((i) => i.name);
}

/** Theorycraft das builds publicadas para o herói, com apoio e checagem contra partidas. */
function theoriesSection(app: App, heroId: number): HTMLElement | null {
  const mine = (app.data.theories ?? []).filter((t) => t.heroId === heroId);
  if (!mine.length) return null;
  const byClass = new Map(app.data.items.map((i) => [i.className, i]));
  const card = (t: Theory) =>
    h(
      "li",
      { class: "theory" },
      h("h4", {}, trData(t.title)),
      h("p", {}, trData(t.claim), t.condition ? tr(` Quando: ${t.condition}.`, ` When: ${trData(t.condition)}.`) : ""),
      h(
        "ul",
        { class: "compare-items", "aria-label": tr("Itens da teoria", "Theory items") },
        t.items.map((c) => byClass.get(c)).filter((i) => i !== undefined).map((i) => h("li", {}, itemIcon(app, i, `item-icon small buy-${i.slot}`))),
      ),
      h(
        "p",
        { class: "buy-meta" },
        `${t.builds.length} ${t.builds.length === 1 ? tr("build publicada", "published build") : tr("builds publicadas", "published builds")}` +
          (t.evidence
            ? `, ${verdictLabel()[t.evidence.verdict]}${t.evidence.matches ? ` (${t.evidence.lift >= 0 ? "+" : ""}${fmt1(t.evidence.lift)} pp ${tr("em", "in")} ${fmt(t.evidence.matches)} ${tr("partidas", "matches")})` : ""}`
            : ""),
      ),
    );
  return h(
    "section",
    { class: "theories" },
    h("h2", {}, tr("Teorias da comunidade", "Community theories")),
    h(
      "p",
      { class: "hint" },
      tr(
        "Ideias tiradas das builds mais favoritadas do patch atual no navegador de builds do jogo. Combos são conferidos contra partidas reais: juntos, os itens ganham mais que o melhor deles sozinho?",
        "Ideas taken from the most favorited builds of the current patch in the game's build browser. Combos are checked against real matches: together, do the items win more than the best of them alone?",
      ),
    ),
    theoryGroups().map((g) => {
      const list = mine
        .filter((t) => t.kind === g.kind && t.evidence?.verdict !== "contradicted")
        .sort((a, b) => b.builds.length - a.builds.length || b.favorites - a.favorites)
        .slice(0, THEORIES_PER_GROUP);
      return list.length ? h("div", { class: "theory-group" }, h("h3", {}, g.title), h("p", { class: "hint" }, g.hint), h("ul", { class: "theory-list" }, list.map(card))) : null;
    }),
  );
}

/** De onde vem a vida efetiva da build final: vida e resistência, mais o que só itens dão. */
function defenseLine(result: OptimizeResult): HTMLElement {
  const d = defenseOf(result.build);
  const parts = [
    d.barrier > 0 ? tr(`barreiras somam ${fmt(d.barrier)} de vida por luta`, `barriers add ${fmt(d.barrier)} HP per fight`) : "",
    d.time > 0 ? tr(`invulnerabilidade e imunidades estendem a luta em ${Math.round(d.time * 100)}%`, `invulnerability and immunities extend the fight by ${Math.round(d.time * 100)}%`) : "",
    d.cc > 0 ? tr(`proteção contra controle de ${Math.round(d.cc * 100)}%`, `${Math.round(d.cc * 100)}% protection against control`) : "",
    d.deflect > 0 ? tr(`${Math.round(d.deflect * 100)}% das balas desviadas`, `${Math.round(d.deflect * 100)}% of bullets deflected`) : "",
  ].filter(Boolean);
  const where = d.sources.length ? ` (${[...new Set(d.sources.map((s) => s.name))].join(", ")})` : "";
  return h(
    "p",
    { class: "hint" },
    tr(`Vida efetiva no fim: ${fmt(result.metrics.ehp)}.`, `Final effective HP: ${fmt(result.metrics.ehp)}.`) +
      (parts.length
        ? tr(` Além de vida e resistência, ${parts.join(", ")}${where}.`, ` Besides health and resistance, ${parts.join(", ")}${where}.`)
        : tr(" Só vida e resistência: nenhum item de barreira, imunidade ou proteção contra controle.", " Only health and resistance: no barrier, immunity or control-protection items.")),
  );
}

/** Trocas ao longo da partida: o que foi vendido para abrir espaço, e por quê. */
function swapList(result: OptimizeResult): HTMLElement | null {
  const swaps = result.order.filter((s) => s.sold);
  if (!swaps.length) return null;
  return h(
    "details",
    { class: "swaps" },
    h("summary", {}, tr(`${swaps.length} ${swaps.length === 1 ? "troca" : "trocas"} até a build final`, `${swaps.length} ${swaps.length === 1 ? "swap" : "swaps"} up to the final build`)),
    h(
      "ul",
      {},
      swaps.map((s) =>
        h(
          "li",
          {},
          tr(
            `Por volta do minuto ${Math.round(s.minute)}: vende ${s.sold!.name} (T${s.sold!.tier}) e compra ${s.item.name} (T${s.item.tier})${s.gain > 0 ? `, +${fmt1(s.gain * 100)} pts` : ""}${s.community ? `, como em ${s.community.builds} ${s.community.builds === 1 ? "build publicada" : "builds publicadas"}` : ""}.`,
            `Around minute ${Math.round(s.minute)}: sells ${s.sold!.name} (T${s.sold!.tier}) and buys ${s.item.name} (T${s.item.tier})${s.gain > 0 ? `, +${fmt1(s.gain * 100)} pts` : ""}${s.community ? `, as in ${s.community.builds} ${s.community.builds === 1 ? "published build" : "published builds"}` : ""}.`,
          ),
        ),
      ),
    ),
  );
}

function finalBuild(app: App, result: OptimizeResult, slots: number): HTMLElement {
  const items = [...result.items].sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] || b.tier - a.tier || b.cost - a.cost);
  const actives = items.filter((i) => i.isActive).length;
  const sales = result.order.filter((s) => s.sold).length;
  const upgrades = result.order.filter((s) => s.upgradeFrom).length;
  const value = items.reduce((sum, i) => sum + i.cost, 0);
  const bySlot = (slot: Item["slot"]) => items.filter((i) => i.slot === slot).reduce((sum, i) => sum + i.cost, 0);
  const history = [
    upgrades ? `${upgrades} ${upgrades === 1 ? "upgrade" : "upgrades"}` : "",
    sales ? `${sales} ${sales === 1 ? tr("venda", "sale") : tr("vendas", "sales")}` : "",
  ].filter(Boolean);
  const active = tr(", ativo", ", active");
  const free = tr("Slot livre", "Empty slot");

  const cells = [
    ...items.map((item) =>
      h(
        "li",
        { class: `final-item buy-${item.slot}` },
        itemIcon(app, item, `item-icon buy-${item.slot}`),
        h("span", { class: "final-name" }, item.name),
        h("span", { class: "final-meta" }, `T${item.tier}${item.isActive ? active : ""}`),
      ),
    ),
    ...Array.from({ length: Math.max(0, slots - items.length) }, () => h("li", { class: "final-item final-empty", "aria-label": free }, h("span", { class: "final-slot" }), h("span", { class: "final-name" }, free))),
  ];

  return h(
    "section",
    { class: "final-build" },
    h("h2", {}, tr("Build final", "Final build")),
    h(
      "p",
      { class: "hint" },
      tr(
        `${items.length} de ${slots} slots ocupados e ${actives} de ${MAX_ACTIVE_ITEMS} itens ativos${history.length ? `, depois de ${history.join(" e ")}` : ""}. ` +
          `Valor dos itens: ${fmt(value)} souls (arma ${fmt(bySlot("weapon"))}, vitalidade ${fmt(bySlot("vitality"))}, spirit ${fmt(bySlot("spirit"))}).`,
        `${items.length} of ${slots} slots filled and ${actives} of ${MAX_ACTIVE_ITEMS} active items${history.length ? `, after ${history.join(" and ")}` : ""}. ` +
          `Item value: ${fmt(value)} souls (weapon ${fmt(bySlot("weapon"))}, vitality ${fmt(bySlot("vitality"))}, spirit ${fmt(bySlot("spirit"))}).`,
      ),
    ),
    h("ul", { class: "final-grid", "aria-label": tr(`Itens no fim: ${items.length} de ${slots} slots`, `Final items: ${items.length} of ${slots} slots`) }, cells),
    defenseLine(result),
    swapList(result),
  );
}

function purchaseList(app: App, result: OptimizeResult, heroId: number): HTMLElement {
  const { state } = app;
  const meta = heroMeta(app.data, heroId);
  const usage = (item: Item) => {
    if (!meta) return "";
    const rate = pickRate(meta, item);
    return rate === null
      ? tr(" Quase ninguém compra com este herói.", " Almost nobody buys it on this hero.")
      : tr(` Comprado em ${fmt(rate * 100)}% das partidas do herói.`, ` Bought in ${fmt(rate * 100)}% of the hero's matches.`);
  };
  if (result.order.length === 0) {
    return h("p", { class: "empty" }, tr("Nenhum item cabe nesse orçamento. Aumente os souls para ver a primeira compra.", "No item fits this budget. Raise the souls to see the first purchase."));
  }
  let lastPhase = "";
  const rows = result.order.flatMap((step) => {
    const phase = phaseOf(step.minute);
    const label = phaseLabel(step.minute);
    const title = `${label[0]!.toUpperCase()}${label.slice(1)}`;
    const header = phase !== lastPhase ? h("li", { class: "phase", "aria-hidden": "true" }, tr(`${title} da partida`, `${title} game`)) : null;
    lastPhase = phase;
    return header ? [header, buyRow(step)] : [buyRow(step)];
  });
  return h("ol", { class: "buys" }, rows);

  function buyRow(step: OptimizeResult["order"][number]): HTMLElement {
    const gain = step.gain;
    const pinned = state.required.includes(step.item.name);
    const upgrade = result.order.find((later) => later.upgradeFrom === step.item);
    const sale = result.order.find((later) => later.sold === step.item);
    const notes = [
      step.upgradeFrom ? tr(`Melhora ${step.upgradeFrom.name}, já pago em parte.`, `Upgrades ${step.upgradeFrom.name}, already partly paid for.`) : "",
      step.sold ? tr(`Vende ${step.sold.name} para abrir o slot.`, `Sells ${step.sold.name} to free the slot.`) : "",
      upgrade
        ? tr(`Rende enquanto junta souls e depois vira ${upgrade.item.name}.`, `Pays off while saving souls, then becomes ${upgrade.item.name}.`)
        : step.isComponent
          ? tr("Rende enquanto junta souls e depois vira componente de um upgrade.", "Pays off while saving souls, then becomes a component of an upgrade.")
          : "",
      sale ? tr(`Vendido depois, para dar lugar a ${sale.item.name}.`, `Sold later, to make room for ${sale.item.name}.`) : "",
    ].filter(Boolean);
    const reasons = [...notes, ...(step.isComponent || sale ? [] : reasonsFor(app, step.item, heroId, result.items.filter((i) => i !== step.item)))].slice(0, 3);
    const real = buyMinute(app.data, heroId, step.item);
    const when = tr(
      `Paga ${fmt(step.cost)} com ${fmt(step.earned)} souls ganhos, por volta do minuto ${Math.round(step.minute)}${real === null ? "" : ` (jogadores: minuto ${Math.round(real)})`}.`,
      `Pays ${fmt(step.cost)} with ${fmt(step.earned)} souls earned, around minute ${Math.round(step.minute)}${real === null ? "" : ` (players: minute ${Math.round(real)})`}.`,
    );
    return h(
      "li",
      { class: `buy buy-${step.item.slot}` },
      itemIcon(app, step.item, "item-icon"),
      h(
        "div",
        { class: "buy-main" },
        h(
          "h3",
          {},
          h("span", {}, step.item.name),
          " ",
          step.item.isActive ? h("span", { class: "chip" }, tr("ativo", "active")) : null,
          " ",
          step.isComponent ? h("span", { class: "chip" }, tr("componente", "component")) : null,
          " ",
          sale ? h("span", { class: "chip" }, tr("vendido depois", "sold later")) : null,
          " ",
          step.opensCombo ? h("span", { class: "chip chip-combo" }, tr(`abre jogada com ${step.opensCombo.join(", ")}`, `opens a play with ${step.opensCombo.join(", ")}`)) : null,
          " ",
          step.tieBreak
            ? h(
                "span",
                {
                  class: "chip chip-combo",
                  title: tr(
                    `Ganho por soul quase igual ao de ${step.tieBreak.over.name}; quando comprado aos ${step.tieBreak.window}, vence ${fmt1(step.tieBreak.diff)} pp mais (± ${fmt1(step.tieBreak.margin)}).`,
                    `Gain per soul almost equal to ${step.tieBreak.over.name}'s; when bought at ${step.tieBreak.window}, wins ${fmt1(step.tieBreak.diff)} pp more (± ${fmt1(step.tieBreak.margin)}).`,
                  ),
                },
                tr(`desempate pelas partidas: no lugar de ${step.tieBreak.over.name}`, `tiebreak by matches: instead of ${step.tieBreak.over.name}`),
              )
            : null,
          " ",
          step.matchPrior && Math.abs(step.matchPrior.factor - 1) >= 0.05
            ? h(
                "span",
                {
                  class: `chip ${step.matchPrior.factor > 1 ? "chip-combo" : "chip-warn"}`,
                  title: matchPriorText(step.matchPrior),
                },
                tr(`partidas ×${step.matchPrior.factor.toFixed(2)}`, `matches ×${step.matchPrior.factor.toFixed(2)}`),
              )
            : null,
        ),
        h("p", { class: "buy-meta" }, `${slotLabel()[step.item.slot]}, tier ${step.item.tier}. ${when}${step.isComponent || sale ? "" : usage(step.item)}`),
        step.why ? whyBlock(step.why) : null,
        reasons.length ? h("ul", { class: "reasons" }, reasons.map(reasonItem)) : null,
        step.isComponent
          ? null
          : h(
              "div",
              { class: "buy-actions" },
              h(
                "button",
                {
                  class: "link",
                  "aria-pressed": String(pinned),
                  onclick: () => app.update({ required: pinned ? state.required.filter((n) => n !== step.item.name) : [...state.required, step.item.name] }),
                },
                pinned ? tr("Soltar", "Unlock") : tr("Fixar", "Lock"),
              ),
              h(
                "button",
                {
                  class: "link",
                  onclick: () => app.update({ banned: [...state.banned, step.item.name], required: state.required.filter((n) => n !== step.item.name) }),
                },
                tr("Tirar da build", "Remove from build"),
              ),
            ),
      ),
      h("div", { class: "buy-side" }, h("span", { class: "gain", title: tr("Ganho na pontuação do objetivo com esta compra", "Gain in the goal score from this purchase") }, `${gain >= 0 ? "+" : "−"}${fmt(Math.abs(gain) * 100)} pts`)),
    );
  }
}

/** Dica do chip "partidas ×N": de onde veio o Δ e quanto ele mudou o ganho por soul. */
function matchPriorText(p: NonNullable<OptimizeResult["order"][number]["matchPrior"]>): string {
  const d = `${signedPp(p.delta)} ± ${fmt1(p.margin)}`;
  const factor = tr(` O ganho por soul do modelo foi multiplicado por ${p.factor.toFixed(2)}.`, ` The model's gain per soul was multiplied by ${p.factor.toFixed(2)}.`);
  if (p.source === "wpa")
    return (
      tr(
        `Vitória acima do esperado pelo placar de patrimônio na hora da compra: ${d} contra os outros itens do mesmo tier (${fmt(p.matches)} compras).`,
        `Wins above expectation given the net worth score at purchase time: ${d} vs other items of the same tier (${fmt(p.matches)} purchases).`,
      ) + factor
    );
  if (p.source === "blend")
    return (
      tr(
        `Partidas, combinando o winrate comprado aos ${p.window} com a vitória acima do esperado pelo placar de patrimônio (que tira o viés de quem já está ganhando): ${d} contra os outros itens do mesmo tier.`,
        `Matches, combining the winrate when bought at ${p.window} with wins above expectation given the net worth score (which removes the bias of players already winning): ${d} vs other items of the same tier.`,
      ) + factor
    );
  return (
    tr(
      `Comprado aos ${p.window}, vence ${d} contra os outros itens do mesmo tier (${fmt(p.matches)} partidas).`,
      `Bought at ${p.window}, wins ${d} against the other items of the same tier (${fmt(p.matches)} matches).`,
    ) + factor
  );
}

const confidenceHint = () => ({
  works: tr(
    "Confiança de que a interação funciona como modelada (fontes das mecânicas, campos desconhecidos, patch).",
    "Confidence that the interaction works as modeled (mechanic sources, unknown fields, patch).",
  ),
  best: tr(
    "Confiança de que esta é a melhor compra agora (distância para a alternativa, dados de partidas).",
    "Confidence that this is the best purchase now (gap to the alternative, match data).",
  ),
});

/** Nível de confiança para exibir (o valor interno fica em português: é também classe CSS). */
const confidenceText = (c: string) => tr(c, ({ alta: "high", média: "medium", baixa: "low" } as Record<string, string>)[c] ?? c);

/** Por que comprar agora: jogada, condição, métrica, alternativa e incerteza, calculados pelo motor. */
function whyBlock(why: Recommendation): HTMLElement | null {
  const gained = why.deltaU > 0.5;
  if (!gained && !why.text) return null;
  return h(
    "div",
    { class: "why" },
    why.text ? h("p", { class: "why-play" }, why.text) : null,
    gained
      ? h(
          "p",
          { class: "why-facts" },
          `${why.mechanism[0]!.toUpperCase()}${why.mechanism.slice(1)}. ${why.metric}.`,
          why.condition ? tr(` Condição: ${why.condition}.`, ` Condition: ${why.condition}.`) : "",
        )
      : null,
    h(
      "p",
      { class: "why-meta" },
      h("span", { class: `conf conf-${why.confidenceWorks}`, title: confidenceHint().works }, tr(`interação: confiança ${why.confidenceWorks}`, `interaction: ${confidenceText(why.confidenceWorks)} confidence`)),
      " ",
      h("span", { class: `conf conf-${why.confidenceBest}`, title: confidenceHint().best }, tr(`melhor agora: confiança ${why.confidenceBest}`, `best now: ${confidenceText(why.confidenceBest)} confidence`)),
      " ",
      h(
        "span",
        { class: "hint" },
        why.kind === "mecânica"
          ? tr("só mecânica (sem dados de partidas)", "mechanics only (no match data)")
          : tr(`mecânica + ${fmt(why.observed!.matches)} partidas`, `mechanics + ${fmt(why.observed!.matches)} matches`),
      ),
    ),
    why.observed ? observedLine(why.observed) : null,
    why.observed?.wpa ? wpaLine(why.observed.wpa) : null,
    h(
      "details",
      { class: "why-details" },
      h("summary", {}, tr("Fontes, alternativa e incertezas", "Sources, alternative and uncertainties")),
      why.alternative
        ? h(
            "p",
            {},
            tr(
              `Alternativa com o mesmo orçamento: ${why.alternative.name} (jogadas ${why.alternative.deltaU >= 0 ? "+" : "−"}${fmt1(Math.abs(why.alternative.deltaU))} contra ${why.deltaU >= 0 ? "+" : "−"}${fmt1(Math.abs(why.deltaU))}).`,
              `Alternative with the same budget: ${why.alternative.name} (plays ${why.alternative.deltaU >= 0 ? "+" : "−"}${fmt1(Math.abs(why.alternative.deltaU))} vs ${why.deltaU >= 0 ? "+" : "−"}${fmt1(Math.abs(why.deltaU))}).`,
            ),
          )
        : null,
      why.parts.length
        ? h(
            "p",
            {},
            tr(`De onde vem o ganho (repetindo a jogada sem cada efeito): `, `Where the gain comes from (replaying without each effect): `) +
              `${why.parts.map((p) => `${p.label} ${p.value >= 0 ? "+" : "−"}${fmt1(Math.abs(p.value))}`).join("; ")}.`,
          )
        : null,
      h("ul", {}, why.sources.map((s) => h("li", {}, s))),
      h("ul", { class: "uncertain" }, why.uncertainty.map((u) => h("li", {}, u))),
    ),
  );
}

const signedPp = (x: number) => `${x >= 0 ? "+" : "−"}${fmt1(Math.abs(x))} pp`;

/** Vitória acima do esperado pelo estado da partida na hora da compra, e se o item rende mais atrás ou à frente. */
function wpaLine(w: ItemWpa): HTMLElement {
  const lean =
    w.lean === "comeback"
      ? tr(
          ` Rende mais comprado atrás (${signedPp(w.behind!)}) do que à frente (${signedPp(w.ahead!)}): item de virada.`,
          ` Pays off more when bought behind (${signedPp(w.behind!)}) than ahead (${signedPp(w.ahead!)}): a comeback item.`,
        )
      : w.lean === "win-more"
        ? tr(
            ` Rende mais comprado à frente (${signedPp(w.ahead!)}) do que atrás (${signedPp(w.behind!)}): ajuda a fechar, pouco a virar.`,
            ` Pays off more when bought ahead (${signedPp(w.ahead!)}) than behind (${signedPp(w.behind!)}): helps close out, little to turn things around.`,
          )
        : "";
  return h(
    "p",
    { class: "why-facts" },
    tr(
      `Pelo placar de patrimônio na hora da compra: ${signedPp(w.relative)} ± ${fmt1(w.margin)} de vitória acima do esperado contra os outros itens do mesmo tier (${fmt(w.purchases)} compras).`,
      `Given the net worth score at purchase time: ${signedPp(w.relative)} ± ${fmt1(w.margin)} wins above expectation vs other items of the same tier (${fmt(w.purchases)} purchases).`,
    ),
    lean,
  );
}

/** O que as partidas dizem, no mesmo momento da compra (ou a média do herói, sem janela). */
function observedLine(o: NonNullable<Recommendation["observed"]>): HTMLElement {
  if (!o.window)
    return h(
      "p",
      { class: "why-facts" },
      tr(
        `Partidas: ${signedPp(o.winrateDelta)} contra a média do herói, sem controlar o momento da compra.`,
        `Matches: ${signedPp(o.winrateDelta)} vs the hero average, without controlling for purchase timing.`,
      ),
    );
  const vs = o.versusAlternative;
  return h(
    "p",
    { class: `why-facts${o.diverges ? " diverges" : ""}` },
    tr(
      `Partidas, comprado aos ${o.window.window}: ${signedPp(o.window.delta)} ± ${fmt1(o.window.margin)} contra o que o herói compra nessa janela (${fmt(o.window.matches)} partidas).`,
      `Matches, bought at ${o.window.window}: ${signedPp(o.window.delta)} ± ${fmt1(o.window.margin)} vs what the hero buys in that window (${fmt(o.window.matches)} matches).`,
    ),
    vs
      ? tr(
          ` Contra ${vs.name}: ${signedPp(vs.diff)} ± ${fmt1(vs.margin)}${vs.significant ? "" : ", sem diferença clara"}.`,
          ` Vs ${vs.name}: ${signedPp(vs.diff)} ± ${fmt1(vs.margin)}${vs.significant ? "" : ", no clear difference"}.`,
        )
      : "",
    o.diverges ? tr(" O modelo e as partidas apontam para lados opostos.", " The model and the matches point in opposite directions.") : "",
  );
}

/** Jogadas da build final por tipo de luta (simulação), alternativas situacionais e regras da loja. */
function playPanel(app: App, payload: BuildPayload, input: OptimizeInput): HTMLElement {
  // Simulação, trocas situacionais e checagem da rota vêm prontas do worker (compute.ts).
  const { scenarios, situational: situ, issues } = payload;
  return h(
    "section",
    { class: "plays" },
    h("h2", {}, tr("Jogadas da build", "Build plays")),
    h(
      "p",
      { class: "hint" },
      input.fights
        ? tr(`Luta escolhida: ${input.fights.map((f) => SCENARIO_LABEL[f]).join(", ")}.`, `Chosen fight: ${input.fights.map((f) => SCENARIO_LABEL[f]).join(", ")}.`)
        : app.data.fights
          ? tr(`Mistura de lutas medida nas partidas: `, `Fight mix measured in matches: `) +
            `${(Object.entries(scenarioMix()) as [ScenarioId, number][]).filter(([, w]) => w > 0).map(([id, w]) => `${SCENARIO_LABEL[id].toLowerCase()} ${Math.round(w * 100)}%`).join(", ")}` +
            tr(` (perseguição e iniciação com peso fixo).`, ` (chase and enemy engage with fixed weight).`)
          : tr(
              "Cenário assumido: mistura de duelo, lutas pequenas, teamfight, inimigos dispersos, perseguição e iniciação inimiga.",
              "Assumed scenario: a mix of duel, small fights, teamfight, spread-out enemies, chase and enemy engage.",
            ),
    ),
    h(
      "ul",
      {},
      scenarios.map((s) => {
        const sim = s.best?.sim;
        const hits = sim ? Object.values(sim.hits).reduce((a, b) => a + b, 0) : 0;
        const esc = sim ? Object.values(sim.escaped).reduce((a, b) => a + b, 0) : 0;
        return h(
          "li",
          {},
          h("span", { class: "ability-name" }, s.label),
          h("span", {}, s.best ? s.best.steps.map((x, i) => (i === 0 ? x.name : `${x.name} (+${fmt1(x.at - s.best!.steps[i - 1]!.at)} s)`)).join(" → ") : tr("nenhuma jogada", "no play")),
          sim
            ? h(
                "span",
                { class: "hint" },
                tr(
                  `${hits} atingidos${esc ? `, ${esc} escapam` : ""}, ${fmt1(sim.control)} s de controle útil${sim.casterAlive ? "" : ", morre antes de concluir"}`,
                  `${hits} hit${esc ? `, ${esc} escape` : ""}, ${fmt1(sim.control)} s of useful control${sim.casterAlive ? "" : ", dies before finishing"}`,
                ),
              )
            : null,
        );
      }),
    ),
    situ.length
      ? h(
          "div",
          {},
          h("h3", {}, tr("Trocas por tipo de luta", "Swaps by fight type")),
          h(
            "ul",
            {},
            situ.map((s) =>
              h(
                "li",
                {},
                h("span", { class: "ability-name" }, s.label),
                h("span", {}, `${s.item.name}${s.replaces ? tr(` no lugar de ${s.replaces.item.name}`, ` instead of ${s.replaces.item.name}`) : ""}`),
                h("span", { class: "hint" }, tr(`+${fmt1(s.gain)} nas jogadas por minuto (${s.mechanism})`, `+${fmt1(s.gain)} in plays per minute (${s.mechanism})`)),
              ),
            ),
          ),
        )
      : null,
    h(
      "p",
      { class: "hint" },
      issues.length
        ? tr(`Atenção, a rota quebra regras da loja: `, `Warning, the route breaks shop rules: `) + `${issues.map((x) => `${x.item}: ${x.problem}`).join("; ")}.`
        : tr(
            "Cada compra cabe nos souls, nos slots e no limite de ativos do momento; upgrades consomem o componente.",
            "Each purchase fits the souls, the slots and the active-item limit at that moment; upgrades consume the component.",
          ),
    ),
  );
}

function bannedBar(app: App): HTMLElement | null {
  const { state } = app;
  if (state.banned.length === 0) return null;
  return h(
    "p",
    { class: "banned" },
    tr("Fora desta build: ", "Out of this build: "),
    state.banned.map((name) =>
      h("button", { class: "chip chip-button", title: tr("Permitir de novo", "Allow again"), onclick: () => app.update({ banned: state.banned.filter((n) => n !== name) }) }, `${name} ×`),
    ),
  );
}

function metricsTable(m: Metrics, b: Metrics): HTMLElement {
  const row = (label: string, base: number, now: number, one = false, sub = false) => {
    const d = delta(now, base);
    return h(
      "tr",
      { class: sub ? "sub" : "" },
      h("th", { scope: "row" }, label),
      h("td", {}, one ? fmt1(base) : fmt(base)),
      h("td", {}, one ? fmt1(now) : fmt(now)),
      h("td", { class: d.startsWith("+") || d === tr("novo", "new") ? "up" : d.startsWith("−") ? "down" : "" }, d),
    );
  };
  return h(
    "table",
    { class: "metrics" },
    h("caption", {}, tr("O que a build muda", "What the build changes")),
    h(
      "thead",
      {},
      h(
        "tr",
        {},
        h("th", { scope: "col" }, tr("Por segundo", "Per second")),
        h("th", { scope: "col" }, tr("Sem itens", "No items")),
        h("th", { scope: "col" }, tr("Com a build", "With build")),
        h("th", { scope: "col" }, tr("Variação", "Change")),
      ),
    ),
    h(
      "tbody",
      {},
      row(tr("Dano total", "Total damage"), b.totalDps, m.totalDps),
      row(tr("Arma", "Weapon"), b.weaponDps, m.weaponDps, false, true),
      row(tr("Habilidades", "Abilities"), b.abilityDps, m.abilityDps, false, true),
      row(tr("Efeitos de itens", "Item effects"), b.itemDps, m.itemDps, false, true),
      row(tr("Corpo a corpo", "Melee"), b.meleeDps, m.meleeDps, false, true),
      ...(m.antiHealDps > 0 ? [row(tr("Cura negada ao inimigo", "Healing denied to enemy"), b.antiHealDps, m.antiHealDps, false, true)] : []),
      row(tr("Cura", "Healing"), b.sustain, m.sustain, true),
    ),
    h(
      "tbody",
      {},
      h("tr", { class: "gap" }, h("th", { scope: "col", colspan: 4 }, tr("Por minuto", "Per minute"))),
      row(tr("Controle (s)", "Control (s)"), b.control, m.control, true),
    ),
    h("tbody", {}, h("tr", { class: "gap" }, h("th", { scope: "col", colspan: 4 }, tr("No total", "Total"))), row(tr("Vida efetiva", "Effective HP"), b.ehp, m.ehp)),
  );
}

function abilityPlan(app: App, result: OptimizeResult): HTMLElement {
  const hero = findHero(app.data, result.hero);
  const abilities = heroAbilities(app.data, hero);
  return h(
    "section",
    { class: "abilities" },
    h("h2", {}, tr("Upgrades de habilidade", "Ability upgrades")),
    h(
      "ul",
      {},
      abilities.map((a) => {
        const tier = result.abilityTiers[a.slot - 1] ?? 0;
        return h(
          "li",
          {},
          abilityIcon(a, "ability-icon"),
          h("span", { class: "ability-name" }, a.name),
          h(
            "span",
            { class: "pips", role: "img", "aria-label": tr(`${tier} de 3 upgrades`, `${tier} of 3 upgrades`) },
            [1, 2, 3].map((t) => h("i", { class: t <= tier ? "pip on" : "pip" })),
          ),
        );
      }),
    ),
    eliteAbilities(app, hero.id, abilities),
  );
}

/** O que o elo alto faz com as habilidades: qual maximiza primeiro e a ordem mais jogada. */
function eliteAbilities(app: App, heroId: number, abilities: Ability[]): HTMLElement | null {
  const elite = heroElite(app.data, heroId);
  if (!elite) return null;
  const nameOf = (slot: number) => abilities.find((a) => a.slot === slot)?.name ?? `#${slot}`;
  const maxFirst = eliteMaxFirst(app.data, heroId).filter((m) => m.share >= 0.1);
  const order = eliteAbilityOrder(app.data, heroId, abilities);
  const rank = `${badgeName(elite.badge)}+`;
  return h(
    "div",
    { class: "elite-abilities" },
    h("h3", {}, tr(`No elo alto (${rank})`, `In high elo (${rank})`)),
    maxFirst.length
      ? h(
          "p",
          {},
          tr("Maximizam primeiro: ", "Max first: "),
          maxFirst.flatMap((m, i) => [i ? ", " : "", h("strong", {}, nameOf(m.slot)), ` ${fmt1(m.share * 100)}%`]),
          ".",
        )
      : null,
    order
      ? h(
          "div",
          {},
          h(
            "ol",
            { class: "ability-order", "aria-label": tr("Ordem dos pontos de habilidade", "Ability point order") },
            order.abilities.map((a) => h("li", {}, abilityIcon(a, "ability-icon small"))),
          ),
          h(
            "p",
            { class: "hint" },
            tr(
              `Ordem completa mais jogada (desbloqueios e upgrades), em ${fmt1(order.share * 100)}% das ${fmt(elite.matches)} partidas. Os jogadores variam muito na ordem; o "maximizam primeiro" resume melhor.`,
              `Most played full order (unlocks and upgrades), in ${fmt1(order.share * 100)}% of ${fmt(elite.matches)} matches. Players vary a lot in the order; "max first" sums it up better.`,
            ),
          ),
        )
      : null,
  );
}

function eliteComparison(app: App, payload: BuildPayload, input: OptimizeInput): HTMLElement | null {
  const c = payload.elite;
  const elite = heroElite(app.data, findHero(app.data, input.hero).id);
  if (!c || !elite || !app.data.elite) return null;
  const rank = `${badgeName(elite.badge)}+`;
  const top = fmt1(app.data.elite.share * 100);
  return h(
    "section",
    { class: "compare" },
    h("h2", {}, tr("Comparado com o elo alto", "Compared with high elo")),
    h(
      "p",
      { class: "hint" },
      tr(
        `Itens que os jogadores de ${input.hero} em partidas ${rank} (cerca do top ${top}%) compram em pelo menos ${Math.round(ELITE_PATH_MIN_RATE * 100)}% das partidas, na ordem do minuto médio de compra, nos últimos ${app.data.elite.days} dias. Cortados nos mesmos souls e medidos pelo mesmo motor.`,
        `Items that ${input.hero} players in ${rank} matches (about the top ${top}%) buy in at least ${Math.round(ELITE_PATH_MIN_RATE * 100)}% of matches, in order of average purchase minute, over the last ${app.data.elite.days} days. Cut at the same souls and measured by the same engine.`,
      ),
    ),
    h(
      "ol",
      { class: "compare-list" },
      comparisonCard(app, c, payload.result, {
        title: tr(`Caminho ${rank}`, `${rank} path`),
        summary: tr(
          `${fmt(c.build.matches)} partidas do herói nesse elo, ${fmt1(c.winrate * 100)}% de vitória.`,
          `${fmt(c.build.matches)} matches of the hero at this elo, ${fmt1(c.winrate * 100)}% win rate.`,
        ),
        column: tr("Elo alto", "High elo"),
        listLabel: tr("Itens do elo alto até esses souls", "High elo items up to these souls"),
      }),
    ),
  );
}

interface CardText {
  title: string;
  summary: string;
  column: string;
  listLabel: string;
}

function comparisonCard(app: App, c: BuildComparison, ours: OptimizeResult, text?: CardText): HTMLElement {
  const shared = new Set(c.shared.map((i) => i.className));
  const cm = c.result.metrics;
  const am = ours.metrics;
  const cell = (label: string, theirs: number, ours: number) => h("tr", {}, h("th", { scope: "row" }, label), h("td", {}, fmt(theirs)), h("td", {}, fmt(ours)));
  const v = c.result.vitality;
  const spikeNote =
    v?.reachedAt != null
      ? tr(` Pico de vitality por volta do minuto ${Math.round(v.reachedMinute ?? 0)}.`, ` Vitality spike around minute ${Math.round(v.reachedMinute ?? 0)}.`)
      : tr(" Não chega ao pico de vitality com esses souls.", " Doesn't reach the vitality spike with these souls.");
  return h(
    "li",
    { class: "compare-card" },
    h("h3", {}, text?.title ?? (c.build.name || tr("Build sem nome", "Unnamed build"))),
    h("p", { class: "buy-meta" }, (text?.summary ?? tr(`${fmt(c.build.matches)} partidas, ${fmt1(c.winrate * 100)}% de vitória.`, `${fmt(c.build.matches)} matches, ${fmt1(c.winrate * 100)}% win rate.`)) + spikeNote),
    h(
      "ul",
      { class: "compare-items", "aria-label": text?.listLabel ?? tr("Itens da build publicada até esses souls", "Items of the published build up to these souls") },
      c.items.map((i) =>
        h(
          "li",
          { class: shared.has(i.className) ? "in-both" : "" },
          itemIcon(app, i, `item-icon small buy-${i.slot}`),
        ),
      ),
    ),
    h(
      "table",
      { class: "metrics compact" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, tr("Pelo motor", "By the engine")), h("th", { scope: "col" }, text?.column ?? tr("Publicada", "Published")), h("th", { scope: "col" }, "App"))),
      h(
        "tbody",
        {},
        cell(tr("Dano total/s", "Total damage/s"), cm.totalDps, am.totalDps),
        cell(tr("Vida efetiva", "Effective HP"), cm.ehp, am.ehp),
        cell(tr("Pontos", "Points"), c.result.score * 100, ours.score * 100),
      ),
    ),
    h(
      "p",
      { class: "hint" },
      c.onlyApp.length
        ? tr(`Só no app: ${c.onlyApp.map((i) => i.name).join(", ")}.`, `Only in the app: ${c.onlyApp.map((i) => i.name).join(", ")}.`)
        : tr("Todos os itens do app estão nesta build.", "Every app item is in this build."),
    ),
  );
}

function comparison(app: App, payload: BuildPayload, input: OptimizeInput): HTMLElement | null {
  const meta = heroMeta(app.data, findHero(app.data, input.hero).id);
  const cards = payload.comparisons;
  if (!meta || !cards) return null;
  const result = payload.result;
  const best = [...powerWindows(meta)].sort((a, b) => b.winrate - a.winrate)[0];
  const window = best
    ? tr(
        ` ${input.hero} vence mais em partidas de ${best.bucket.fromMin}${best.bucket.toMin ? ` a ${best.bucket.toMin}` : "+"} minutos (${fmt1(best.winrate * 100)}% de vitória).`,
        ` ${input.hero} wins most in matches of ${best.bucket.fromMin}${best.bucket.toMin ? ` to ${best.bucket.toMin}` : "+"} minutes (${fmt1(best.winrate * 100)}% win rate).`,
      )
    : "";
  return h(
    "section",
    { class: "compare" },
    h("h2", {}, tr("Comparado com as builds mais jogadas", "Compared with the most played builds")),
    h(
      "p",
      { class: "hint" },
      tr(
        `Builds publicadas no jogo com mais partidas nos últimos ${app.data.stats!.days} dias, cortadas nos mesmos souls e medidas pelo mesmo motor. Ícones com borda clara também estão na build do app.${window}`,
        `Builds published in the game with the most matches in the last ${app.data.stats!.days} days, cut at the same souls and measured by the same engine. Icons with a light border are also in the app's build.${window}`,
      ),
    ),
    cards.length
      ? h("ol", { class: "compare-list" }, cards.map((c) => comparisonCard(app, c, result)))
      : h("p", { class: "empty" }, tr("Nenhuma build publicada tem itens que caibam nesses souls.", "No published build has items that fit these souls.")),
  );
}

/** No objetivo "Otimizada", diz qual vida efetiva mínima foi exigida e se a build chegou lá. */
function defenseNote(result: OptimizeResult): string {
  const floor = result.weights.ehpFloor;
  if (!floor) return "";
  const target = floor * result.baseline.ehp;
  const ok = result.metrics.ehp >= target * 0.99;
  return tr(
    ` Defesa mínima: ${fmt(target)} de vida efetiva, a das builds mais jogadas com esses souls${ok ? "" : `; esta build fica em ${fmt(result.metrics.ehp)}`}.`,
    ` Minimum defense: ${fmt(target)} effective HP, that of the most played builds at these souls${ok ? "" : `; this build has ${fmt(result.metrics.ehp)}`}.`,
  );
}

/** Explica quanto os efeitos "ao acertar melee" valem para este herói, e de onde vem o número. */
function meleeNote(app: App, result: OptimizeResult, heroId: number): string {
  const share = Math.round(result.build.meleeShare * 100);
  const rate = meleePickRate(app.data, heroId);
  const source =
    rate === null
      ? tr("Sem estatísticas do herói, o motor assume 50%.", "Without hero stats, the engine assumes 50%.")
      : tr(
          `Vem das partidas: os jogadores de ${result.hero} compram itens de melee (Spirit Snatch, Lifestrike, Melee Charge...) em ${Math.round(rate * 100)}% das partidas, em média.`,
          `From matches: ${result.hero} players buy melee items (Spirit Snatch, Lifestrike, Melee Charge...) in ${Math.round(rate * 100)}% of matches, on average.`,
        );
  return tr(`Efeitos de corpo a corpo valem ${share}% para ${result.hero}. ${source}`, `Melee effects count ${share}% for ${result.hero}. ${source}`);
}

/** De onde vem o controle da build, em segundos por minuto. */
function controlPanel(result: OptimizeResult, uptime: number): HTMLElement {
  const sources = controlBreakdown(result.build, { ...DEFAULT_METRIC_OPTIONS, uptime });
  return h(
    "section",
    { class: "control-sources" },
    h("h2", {}, tr("De onde vem o controle", "Where the control comes from")),
    sources.length
      ? h(
          "ul",
          {},
          sources.map((s) =>
            h(
              "li",
              {},
              h("span", { class: "ability-name" }, s.name),
              h("span", { class: "hint" }, s.kinds.map((k) => CONTROL_LABEL[k]).join(", ")),
              h("strong", {}, `${fmt1(s.perMinute)} s/min`),
            ),
          ),
        )
      : h("p", { class: "empty" }, tr("Nenhuma habilidade ou item desta build aplica controle.", "No ability or item in this build applies control.")),
    h(
      "p",
      { class: "hint" },
      tr(
        "Um segundo de stun vale 1; imobilizar e sono, 0,8; silêncio e hex, 0,6; desarme, 0,5; prender, 0,4; lentidão vale pela força (30% de slow conta 0,15). Assume que a habilidade acerta a cada cooldown.",
        "One second of stun counts 1; immobilize and sleep, 0.8; silence and hex, 0.6; disarm, 0.5; tether, 0.4; slow counts by strength (30% slow counts 0.15). Assumes the ability hits on every cooldown.",
      ),
    ),
  );
}


/** Configuração do otimizador a partir do estado da tela. */
function inputFor(app: App): OptimizeInput {
  const { state, data } = app;
  const spike = vitalitySpikeOf(data, findHero(data, state.hero).id, VITALITY_SPIKE_SOULS);
  const objective = objectiveFor(app);
  const archetype = selectedArchetype(app);
  const byClass = new Map(data.items.map((i) => [i.className, i]));
  return {
    hero: state.hero,
    objective:
      objective === "archetype" && archetype
        ? archetypeWeights(data, state.hero, archetype.items.map((c) => byClass.get(c)).filter((i) => i !== undefined), SOULS)
        : objective === "archetype"
          ? "optimized"
          : objective,
    souls: SOULS,
    itemSlots: SLOTS,
    required: state.required,
    banned: state.banned,
    metric: { uptime: UPTIME },
    vitalitySpike: spike ? { souls: VITALITY_SPIKE_SOULS, deadline: spike.souls } : false,
    mode: state.progressive === false ? "final" : "progressive",
    explain: true,
  };
}

/** Último resultado desenhado: fica na tela, esmaecido, enquanto o próximo é calculado. */
let shown: { payload: BuildPayload; input: OptimizeInput } | null = null;

function resultHead(app: App, input: OptimizeInput, summary: string | HTMLElement): HTMLElement {
  const hero = findHero(app.data, input.hero);
  const objective = objectiveOf(input);
  return h(
    "header",
    { class: "result-head" },
    icon(hero.image, hero.name, "portrait portrait-big"),
    h(
      "div",
      {},
      h(
        "h1",
        {},
        objective === "optimized"
          ? tr(`${hero.name}, build otimizada`, `${hero.name}, optimized build`)
          : tr(`${hero.name}, build de ${objectiveLabel()[objective].name.toLowerCase()}`, `${hero.name}, ${objectiveLabel()[objective].name.toLowerCase()} build`),
      ),
      typeof summary === "string" ? h("p", {}, summary) : summary,
    ),
  );
}

/** Aviso de cálculo em andamento (anunciado por leitores de tela). */
function calculating(input: OptimizeInput): HTMLElement {
  return h(
    "p",
    { class: "calculating", role: "status" },
    h("span", { class: "spinner", "aria-hidden": "true" }),
    tr(`Calculando a build para ${fmt(input.souls)} souls…`, `Calculating the build for ${fmt(input.souls)} souls…`),
  );
}

/** A build calculada. `status` entra no topo (aviso de recálculo sobre um resultado antigo). */
function resultView(app: App, payload: BuildPayload, input: OptimizeInput, status: HTMLElement | null = null): HTMLElement {
  const { result } = payload;
  const hero = findHero(app.data, input.hero);
  const objective = objectiveOf(input);
  const slots = input.itemSlots ?? 9;
  const progression = progressionFromSouls(app.data.shared, input.souls);
  return h(
    "main",
    { class: status ? "result stale" : "result", "aria-busy": status ? "true" : null },
    status,
    resultHead(
      app,
      input,
      tr(
        `Nível ${progression.level} com ${fmt(input.souls)} souls. ${result.items.length} ${result.items.length === 1 ? "item" : "itens"} em ${slots} slots, ${fmt1(result.score)}× a pontuação do herói sem itens.${defenseNote(result)}`,
        `Level ${progression.level} with ${fmt(input.souls)} souls. ${result.items.length} ${result.items.length === 1 ? "item" : "items"} in ${slots} slots, ${fmt1(result.score)}× the hero's score with no items.${defenseNote(result)}`,
      ),
    ),
    soulTrack(app, result),
    finalBuild(app, result, slots),
    h(
      "div",
      { class: "columns" },
      h("section", { class: "order" }, h("h2", {}, tr("Ordem de compra", "Purchase order")), bannedBar(app), purchaseList(app, result, hero.id)),
      h(
        "div",
        { class: "side" },
        metricsTable(result.metrics, result.baseline),
        h("p", { class: "hint" }, meleeNote(app, result, hero.id)),
        objective === "control" ? controlPanel(result, input.metric?.uptime ?? UPTIME) : null,
        playPanel(app, payload, input),
        abilityPlan(app, result),
        h(
          "p",
          { class: "caveat" },
          tr(
            "Os números são estimativas para comparar builds do mesmo herói. Dano de habilidade assume uso a cada cooldown; dano de efeitos de itens é o menos preciso. Confira no sandbox antes de confiar.",
            "The numbers are estimates for comparing builds of the same hero. Ability damage assumes use on every cooldown; item effect damage is the least precise. Check in the sandbox before trusting it.",
          ),
        ),
      ),
    ),
    theoriesSection(app, hero.id),
    eliteComparison(app, payload, input),
    comparison(app, payload, input),
  );
}

/** Enquanto o worker calcula: o resultado anterior do mesmo herói, esmaecido, ou só o cabeçalho. */
function pendingView(app: App, input: OptimizeInput): HTMLElement {
  if (shown && shown.input.hero === input.hero) return resultView(app, shown.payload, shown.input, calculating(input));
  const hero = findHero(app.data, input.hero);
  const progression = progressionFromSouls(app.data.shared, input.souls);
  return h(
    "main",
    { class: "result", "aria-busy": "true" },
    resultHead(app, input, tr(`Nível ${progression.level} com ${fmt(input.souls)} souls, ${input.itemSlots ?? 9} slots.`, `Level ${progression.level} with ${fmt(input.souls)} souls, ${input.itemSlots ?? 9} slots.`)),
    calculating(input),
    theoriesSection(app, hero.id),
  );
}

function failureView(app: App, input: OptimizeInput, message: string): HTMLElement {
  return h(
    "main",
    { class: "result" },
    resultHead(app, input, `${fmt(input.souls)} souls, ${input.itemSlots ?? 9} slots.`),
    h("p", { class: "empty" }, tr(`Não deu para montar a build com essa configuração: ${message}`, `Couldn't build with these settings: ${message}`)),
    bannedBar(app),
  );
}

export function renderBuildView(app: App): HTMLElement {
  const input = inputFor(app);
  const key = inputKey(input);
  const outcome = app.builds.cached(key);
  let main: HTMLElement;
  if (outcome) {
    // Configuração já calculada: desenha na hora e larga um cálculo de outra que ninguém mais vê.
    app.builds.cancelUnless(key);
    if (outcome.ok) shown = { payload: outcome.payload, input };
    main = outcome.ok ? resultView(app, outcome.payload, input) : failureView(app, input, outcome.message);
  } else {
    // Os controles aparecem já; o resultado entra quando o worker responder, se a configuração ainda for a mesma.
    app.builds.request(key, input, (done) => {
      if (app.state.tab === "build" && inputKey(inputFor(app)) === done) app.refresh();
    });
    main = pendingView(app, input);
  }
  return h("div", { class: "layout" }, controls(app), main);
}
