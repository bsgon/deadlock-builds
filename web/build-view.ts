import type { Item } from "../src/data/types.ts";
import { componentTree, heroAbilities, findHero, progressionFromSouls, MAX_ACTIVE_ITEMS } from "../src/engine/index.ts";
import { heroItemFit, itemPairLinks, topLinks, type Link } from "../src/interactions/synergy.ts";
import type { Metrics, Objective } from "../src/optimizer/metrics.ts";
import { compareWithPopular, type BuildComparison } from "../src/meta/compare.ts";
import { buyMinute, heroMeta, meleePickRate, minuteForSouls, pickRate, powerWindows } from "../src/meta/stats.ts";
import { optimize, type OptimizeInput, type OptimizeResult } from "../src/optimizer/optimize.ts";
import { CONTROL_LABEL, CONTROL_MIN_PER_MINUTE, heroControl } from "../src/optimizer/control.ts";
import { defenseOf } from "../src/optimizer/defense.ts";
import type { Theory, TheoryKind } from "../src/knowledge/theories.ts";
import { controlBreakdown, DEFAULT_METRIC_OPTIONS } from "../src/optimizer/metrics.ts";
import { delta, fmt, fmt1, h, icon } from "./dom.ts";
import type { App } from "./main.ts";
import { buildPlay, situationalOptions, type Recommendation } from "../src/combat/explain.ts";
import { SCENARIO_LABEL, scenarioMix, type PlanId, type ScenarioId } from "../src/combat/value.ts";
import { phaseOf, validateRoute } from "../src/optimizer/route.ts";

const OBJECTIVE_LABEL: Record<Objective, { name: string; hint: string }> = {
  optimized: { name: "Otimizada", hint: "dano máximo, com a defesa das builds mais jogadas" },
  dps: { name: "Dano total", hint: "arma, habilidades e efeitos de itens" },
  weapon: { name: "Arma", hint: "tiros e efeitos disparados por bala" },
  spirit: { name: "Spirit", hint: "habilidades e dano de spirit de itens" },
  tank: { name: "Tanque", hint: "vida efetiva contra bala e spirit" },
  sustain: { name: "Sustentação", hint: "cura por segundo, com um pouco de vida" },
  bruiser: { name: "Híbrido", hint: "metade dano, metade vida efetiva" },
  control: { name: "Controle", hint: "stun, silêncio e lentidão, com dano e a defesa da Otimizada" },
};

const SLOT_LABEL = { weapon: "Arma", vitality: "Vitalidade", spirit: "Spirit" } as const;
const MAX_SOULS = 50_000;

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
  return h("li", {}, link.reason, link.source ? [" ", h("a", { href: link.source, target: "_blank", rel: "noopener" }, "fonte")] : null);
}

/** Objetivo em uso: "Controle" volta para "Otimizada" em herói quase sem controle no kit. */
function objectiveFor(app: App): Objective {
  const { state, data } = app;
  return state.objective === "control" && heroControl(data, state.hero) < CONTROL_MIN_PER_MINUTE ? "optimized" : state.objective;
}

function controls(app: App): HTMLElement {
  const { state, data } = app;
  const heroes = h(
    "div",
    { class: "hero-grid", role: "radiogroup", "aria-label": "Herói" },
    data.heroes.map((hero) =>
      h(
        "button",
        {
          class: "hero",
          role: "radio",
          "aria-checked": String(hero.name === state.hero),
          title: hero.name,
          "aria-label": hero.name,
          onclick: () => app.update({ hero: hero.name, required: [], banned: [] }),
        },
        icon(hero.image, hero.name, "portrait"),
      ),
    ),
  );

  const objectives = h(
    "div",
    { class: "objectives", role: "radiogroup", "aria-label": "Objetivo" },
    (Object.keys(OBJECTIVE_LABEL) as Objective[]).map((id) => {
      const kit = id === "control" ? heroControl(data, state.hero) : Infinity;
      const off = kit < CONTROL_MIN_PER_MINUTE;
      return h(
        "button",
        {
          class: "objective",
          role: "radio",
          "aria-checked": String(id === objectiveFor(app)),
          ...(off ? { disabled: true, title: `${state.hero} tem pouco controle no kit (${fmt1(kit)} s/min)` } : {}),
          onclick: () => app.update({ objective: id }),
        },
        h("strong", {}, OBJECTIVE_LABEL[id].name),
        h("span", {}, off ? `${state.hero} quase não tem controle no kit` : OBJECTIVE_LABEL[id].hint),
      );
    }),
  );

  const heroId = findHero(data, state.hero).id;
  const soulsLabel = (value: number) => `${fmt(value)} souls, nível ${progressionFromSouls(data.shared, value).level}, por volta do minuto ${Math.round(minuteForSouls(data, heroId, value))}`;
  const soulsOut = h("output", { for: "souls" }, soulsLabel(state.souls));
  const souls = h("input", {
    id: "souls",
    type: "range",
    min: 0,
    max: MAX_SOULS,
    step: 400,
    value: state.souls,
    oninput: (ev) => {
      const value = Number((ev.target as HTMLInputElement).value);
      soulsOut.textContent = soulsLabel(value);
    },
    onchange: (ev) => app.update({ souls: Number((ev.target as HTMLInputElement).value) }),
  });

  const uptimeOut = h("output", { for: "uptime" }, `${Math.round(state.uptime * 100)}% do tempo`);
  const uptime = h("input", {
    id: "uptime",
    type: "range",
    min: 0,
    max: 100,
    step: 10,
    value: Math.round(state.uptime * 100),
    oninput: (ev) => (uptimeOut.textContent = `${(ev.target as HTMLInputElement).value}% do tempo`),
    onchange: (ev) => app.update({ uptime: Number((ev.target as HTMLInputElement).value) / 100 }),
  });

  const slots = h(
    "select",
    { id: "slots", onchange: (ev) => app.update({ slots: Number((ev.target as HTMLSelectElement).value) }) },
    [9, 10, 11, 12].map((n) => h("option", { value: n, selected: n === state.slots }, n === 9 ? "9 (início da partida)" : `${n} (${n - 9} Walker${n > 10 ? "s" : ""} derrubado${n > 10 ? "s" : ""})`)),
  );

  const spike = h(
    "label",
    { class: "check" },
    h("input", { type: "checkbox", checked: state.vitalitySpike, onchange: (ev) => app.update({ vitalitySpike: (ev.target as HTMLInputElement).checked }) }),
    " Chegar a 4.800 souls em vitality antes do mid game",
  );

  const fp = app.data.fights;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const fightInfo = fp
    ? h(
        "p",
        { class: "hint" },
        `Medido em ${fp.matches.toLocaleString("pt-BR")} partidas: o alvo morre em ${fp.timeToKill.median.toLocaleString("pt-BR")} s (mediana) depois do primeiro dano. `,
        `Das mortes, ${pct(fp.sizes.duel)} são em lutas de 2 heróis, ${pct(fp.sizes.skirmish)} de 3 a 5 e ${pct(fp.sizes.teamfight)} de 6 ou mais. `,
        `Perseguição e iniciação inimiga não aparecem nos dados e têm peso fixo.`,
      )
    : h("p", { class: "hint" }, "Sem dados de lutas das partidas: usa uma luta de 10 s e uma mistura de tipos de luta escolhida pelo projeto.");

  const progressive = h(
    "label",
    { class: "check" },
    h("input", { type: "checkbox", checked: state.progressive, onchange: (ev) => app.update({ progressive: (ev.target as HTMLInputElement).checked }) }),
    " Montar compra a compra, como na partida",
  );

  return h(
    "aside",
    { class: "controls", "aria-label": "Configuração da build" },
    h("section", {}, h("h2", {}, "Herói"), heroes),
    h("section", {}, h("h2", {}, "Objetivo"), objectives),
    h("section", {}, h("h2", {}, h("label", { for: "souls" }, "Souls na partida")), souls, soulsOut),
    h("section", {}, h("h2", {}, h("label", { for: "slots" }, "Slots de item")), slots),
    h("section", {}, h("h2", {}, "Lutas"), fightInfo),
    h(
      "section",
      {},
      h("h2", {}, h("label", { for: "uptime" }, "Efeitos condicionais ativos")),
      uptime,
      uptimeOut,
      h("p", { class: "hint" }, "Quanto do tempo procs e bônus como “acima de 65% de vida” estão valendo. Mais alto favorece itens situacionais."),
    ),
    h(
      "section",
      {},
      h("h2", {}, "Ordem de compra"),
      progressive,
      h(
        "p",
        { class: "hint" },
        "Cada compra é a de maior ganho entre as que o herói já consegue pagar. Itens de 1.600, 3.200 e 6.400 só entram a partir dos souls em que os jogadores desse herói costumam comprá-los. Desmarcado, mostra a build mais forte para os souls finais, que nem sempre dá para montar na partida.",
      ),
    ),
    h(
      "section",
      {},
      h("h2", {}, "Pico de vitality"),
      spike,
      h("p", { class: "hint" }, "Com 4.800 souls em itens de vitality, o bônus de vida base pula de 20% para 38%. O prazo são os souls médios do herói aos 15 minutos."),
    ),
  );
}

/** Trilha de souls: cada compra ocupa uma fatia proporcional ao custo. */
function soulTrack(result: OptimizeResult): HTMLElement {
  const total = Math.max(result.souls, 1);
  const segments = result.order.map((step, i) =>
    h(
      "li",
      {
        class: `seg seg-${step.item.slot}`,
        style: `flex-grow:${step.cost}`,
        title: `${i + 1}. ${step.item.name}: ${fmt(step.cost)} souls (acumulado ${fmt(step.spent)})`,
        "data-step": i,
      },
      icon(step.item.image, step.item.name, "seg-icon"),
    ),
  );
  const left = result.souls - result.spent;
  if (left > 0) segments.push(h("li", { class: "seg seg-left", style: `flex-grow:${left}`, title: `${fmt(left)} souls sem uso` }));

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
  if (v && v.reachedAt !== null) marks.push(mark("spike", v.reachedAt, "4,8k vitality"));
  if (v && v.deadline < total) marks.push(mark("deadline", v.deadline, `mid game, ~${Math.round(v.deadlineMinute)} min`));
  let spikeText = "";
  if (v) {
    if (v.reachedAt !== null) spikeText = ` O pico de vitality vem com ${fmt(v.reachedAt)} souls gastos, por volta do minuto ${Math.round(v.reachedMinute ?? 0)}${v.enforced && !v.ok ? ", depois do prazo" : ""}.`;
    else if (!v.enforced) spikeText = ` Vitality: ${fmt(v.invested)} de 4.800 souls; o prazo do pico é ${fmt(v.deadline)} souls.`;
    else spikeText = " A build não chega ao pico de vitality: os itens fixados ou os slots não deixam.";
  }

  return h(
    "figure",
    { class: "track" },
    h("ol", { class: "track-bar", "aria-label": "Compras na ordem, proporcionais ao custo" }, segments),
    h("div", { class: "track-ticks", "aria-hidden": "true" }, ticks, marks),
    h("figcaption", {}, `${fmt(result.spent)} de ${fmt(result.souls)} souls gastos. A largura de cada fatia é o preço da compra.${spikeText}`),
  );
}

const SLOT_ORDER = { weapon: 0, vitality: 1, spirit: 2 } as const;

/**
 * Inventário no fim da partida: o que sobra depois das vendas e com os componentes
 * já absorvidos pelos upgrades. Mostra todos os slots liberados, inclusive os vazios.
 */
const THEORY_GROUPS: { kind: TheoryKind; title: string; hint: string }[] = [
  { kind: "archetype", title: "Arquétipos", hint: "Estilos de jogo e os itens que os definem." },
  { kind: "combo", title: "Combos", hint: "Itens que os autores juntam, e por quê." },
  { kind: "timing", title: "Prioridades", hint: "O que comprar cedo ou tarde." },
  { kind: "late-swap", title: "Trocas de fim de jogo", hint: "O que vender, e o que entra no lugar." },
  { kind: "situational", title: "Situacionais", hint: "Respostas a situações da partida." },
];
const VERDICT_LABEL = { supported: "confirmada pelos dados", unclear: "sem conclusão nos dados", contradicted: "os dados discordam" } as const;
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
      h("h4", {}, t.title),
      h("p", {}, t.claim, t.condition ? ` Quando: ${t.condition}.` : ""),
      h(
        "ul",
        { class: "compare-items", "aria-label": "Itens da teoria" },
        t.items.map((c) => byClass.get(c)).filter((i) => i !== undefined).map((i) => h("li", { title: i.name }, icon(i.image, i.name, `item-icon small buy-${i.slot}`))),
      ),
      h(
        "p",
        { class: "buy-meta" },
        `${t.builds.length} ${t.builds.length === 1 ? "build publicada" : "builds publicadas"}` +
          (t.evidence ? `, ${VERDICT_LABEL[t.evidence.verdict]}${t.evidence.matches ? ` (${t.evidence.lift >= 0 ? "+" : ""}${fmt1(t.evidence.lift)} pp em ${fmt(t.evidence.matches)} partidas)` : ""}` : ""),
      ),
      t.kind === "archetype"
        ? h("button", { class: "link", onclick: () => app.update({ required: archetypeCore(app, t) }) }, "Montar a build a partir deste arquétipo")
        : null,
    );
  return h(
    "section",
    { class: "theories" },
    h("h2", {}, "Teorias da comunidade"),
    h("p", { class: "hint" }, "Ideias tiradas das builds mais favoritadas do patch atual no navegador de builds do jogo. Combos e arquétipos são conferidos contra partidas reais: juntos, os itens ganham mais que o melhor deles sozinho?"),
    THEORY_GROUPS.map((g) => {
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
    d.barrier > 0 ? `barreiras somam ${fmt(d.barrier)} de vida por luta` : "",
    d.time > 0 ? `invulnerabilidade e imunidades estendem a luta em ${Math.round(d.time * 100)}%` : "",
    d.cc > 0 ? `proteção contra controle de ${Math.round(d.cc * 100)}%` : "",
    d.deflect > 0 ? `${Math.round(d.deflect * 100)}% das balas desviadas` : "",
  ].filter(Boolean);
  const where = d.sources.length ? ` (${[...new Set(d.sources.map((s) => s.name))].join(", ")})` : "";
  return h(
    "p",
    { class: "hint" },
    `Vida efetiva no fim: ${fmt(result.metrics.ehp)}.` + (parts.length ? ` Além de vida e resistência, ${parts.join(", ")}${where}.` : " Só vida e resistência: nenhum item de barreira, imunidade ou proteção contra controle."),
  );
}

/** Trocas ao longo da partida: o que foi vendido para abrir espaço, e por quê. */
function swapList(result: OptimizeResult): HTMLElement | null {
  const swaps = result.order.filter((s) => s.sold);
  if (!swaps.length) return null;
  return h(
    "details",
    { class: "swaps" },
    h("summary", {}, `${swaps.length} ${swaps.length === 1 ? "troca" : "trocas"} até a build final`),
    h(
      "ul",
      {},
      swaps.map((s) =>
        h("li", {}, `Por volta do minuto ${Math.round(s.minute)}: vende ${s.sold!.name} (T${s.sold!.tier}) e compra ${s.item.name} (T${s.item.tier})${s.gain > 0 ? `, +${fmt1(s.gain * 100)} pts` : ""}${s.community ? `, como em ${s.community.builds} ${s.community.builds === 1 ? "build publicada" : "builds publicadas"}` : ""}.`),
      ),
    ),
  );
}

function finalBuild(result: OptimizeResult, slots: number): HTMLElement {
  const items = [...result.items].sort((a, b) => SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot] || b.tier - a.tier || b.cost - a.cost);
  const actives = items.filter((i) => i.isActive).length;
  const sales = result.order.filter((s) => s.sold).length;
  const upgrades = result.order.filter((s) => s.upgradeFrom).length;
  const value = items.reduce((sum, i) => sum + i.cost, 0);
  const bySlot = (slot: Item["slot"]) => items.filter((i) => i.slot === slot).reduce((sum, i) => sum + i.cost, 0);
  const history = [
    upgrades ? `${upgrades} ${upgrades === 1 ? "upgrade" : "upgrades"}` : "",
    sales ? `${sales} ${sales === 1 ? "venda" : "vendas"}` : "",
  ].filter(Boolean);

  const cells = [
    ...items.map((item) =>
      h(
        "li",
        { class: `final-item buy-${item.slot}`, title: `${item.name}: ${SLOT_LABEL[item.slot]}, tier ${item.tier}, ${fmt(item.cost)} souls${item.isActive ? ", ativo" : ""}` },
        icon(item.image, item.name, `item-icon buy-${item.slot}`),
        h("span", { class: "final-name" }, item.name),
        h("span", { class: "final-meta" }, `T${item.tier}${item.isActive ? ", ativo" : ""}`),
      ),
    ),
    ...Array.from({ length: Math.max(0, slots - items.length) }, () => h("li", { class: "final-item final-empty", "aria-label": "Slot livre" }, h("span", { class: "final-slot" }), h("span", { class: "final-name" }, "Slot livre"))),
  ];

  return h(
    "section",
    { class: "final-build" },
    h("h2", {}, "Build final"),
    h(
      "p",
      { class: "hint" },
      `${items.length} de ${slots} slots ocupados e ${actives} de ${MAX_ACTIVE_ITEMS} itens ativos${history.length ? `, depois de ${history.join(" e ")}` : ""}. ` +
        `Valor dos itens: ${fmt(value)} souls (arma ${fmt(bySlot("weapon"))}, vitalidade ${fmt(bySlot("vitality"))}, spirit ${fmt(bySlot("spirit"))}).`,
    ),
    h("ul", { class: "final-grid", "aria-label": `Itens no fim: ${items.length} de ${slots} slots` }, cells),
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
    return rate === null ? " Quase ninguém compra com este herói." : ` Comprado em ${fmt(rate * 100)}% das partidas do herói.`;
  };
  if (result.order.length === 0) {
    return h("p", { class: "empty" }, "Nenhum item cabe nesse orçamento. Aumente os souls para ver a primeira compra.");
  }
  let lastPhase = "";
  const rows = result.order.flatMap((step) => {
    const phase = phaseOf(step.minute);
    const header = phase !== lastPhase ? h("li", { class: "phase", "aria-hidden": "true" }, `${phase[0]!.toUpperCase()}${phase.slice(1)} da partida`) : null;
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
      step.upgradeFrom ? `Melhora ${step.upgradeFrom.name}, já pago em parte.` : "",
      step.sold ? `Vende ${step.sold.name} para abrir o slot.` : "",
      upgrade ? `Rende enquanto junta souls e depois vira ${upgrade.item.name}.` : step.isComponent ? "Rende enquanto junta souls e depois vira componente de um upgrade." : "",
      sale ? `Vendido depois, para dar lugar a ${sale.item.name}.` : "",
    ].filter(Boolean);
    const reasons = [...notes, ...(step.isComponent || sale ? [] : reasonsFor(app, step.item, heroId, result.items.filter((i) => i !== step.item)))].slice(0, 3);
    const real = buyMinute(app.data, heroId, step.item);
    const when = `Paga ${fmt(step.cost)} com ${fmt(step.earned)} souls ganhos, por volta do minuto ${Math.round(step.minute)}${real === null ? "" : ` (jogadores: minuto ${Math.round(real)})`}.`;
    return h(
      "li",
      { class: `buy buy-${step.item.slot}` },
      icon(step.item.image, step.item.name, "item-icon"),
      h(
        "div",
        { class: "buy-main" },
        h(
          "h3",
          {},
          h("span", {}, step.item.name),
          " ",
          step.item.isActive ? h("span", { class: "chip" }, "ativo") : null,
          " ",
          step.isComponent ? h("span", { class: "chip" }, "componente") : null,
          " ",
          sale ? h("span", { class: "chip" }, "vendido depois") : null,
          " ",
          step.opensCombo ? h("span", { class: "chip chip-combo" }, `abre jogada com ${step.opensCombo.join(", ")}`) : null,
          " ",
          step.tieBreak
            ? h(
                "span",
                { class: "chip chip-combo", title: `Ganho por soul quase igual ao de ${step.tieBreak.over.name}; quando comprado aos ${step.tieBreak.window}, vence ${fmt1(step.tieBreak.diff)} pp mais (± ${fmt1(step.tieBreak.margin)}).` },
                `desempate pelas partidas: no lugar de ${step.tieBreak.over.name}`,
              )
            : null,
          " ",
          step.matchPrior && Math.abs(step.matchPrior.factor - 1) >= 0.05
            ? h(
                "span",
                {
                  class: `chip ${step.matchPrior.factor > 1 ? "chip-combo" : "chip-warn"}`,
                  title: `Comprado aos ${step.matchPrior.window}, vence ${fmt1(step.matchPrior.delta)} pp contra os outros itens do mesmo tier (± ${fmt1(step.matchPrior.margin)}, ${step.matchPrior.matches} partidas). O ganho por soul do modelo foi multiplicado por ${step.matchPrior.factor.toFixed(2)}.`,
                },
                `partidas ×${step.matchPrior.factor.toFixed(2)}`,
              )
            : null,
        ),
        h("p", { class: "buy-meta" }, `${SLOT_LABEL[step.item.slot]}, tier ${step.item.tier}. ${when}${step.isComponent || sale ? "" : usage(step.item)}`),
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
                pinned ? "Soltar" : "Fixar",
              ),
              h(
                "button",
                {
                  class: "link",
                  onclick: () => app.update({ banned: [...state.banned, step.item.name], required: state.required.filter((n) => n !== step.item.name) }),
                },
                "Tirar da build",
              ),
            ),
      ),
      h("div", { class: "buy-side" }, h("span", { class: "gain", title: "Ganho na pontuação do objetivo com esta compra" }, `${gain >= 0 ? "+" : "−"}${fmt(Math.abs(gain) * 100)} pts`)),
    );
  }
}

const CONFIDENCE_HINT = {
  works: "Confiança de que a interação funciona como modelada (fontes das mecânicas, campos desconhecidos, patch).",
  best: "Confiança de que esta é a melhor compra agora (distância para a alternativa, dados de partidas).",
};

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
          why.condition ? ` Condição: ${why.condition}.` : "",
        )
      : null,
    h(
      "p",
      { class: "why-meta" },
      h("span", { class: `conf conf-${why.confidenceWorks}`, title: CONFIDENCE_HINT.works }, `interação: confiança ${why.confidenceWorks}`),
      " ",
      h("span", { class: `conf conf-${why.confidenceBest}`, title: CONFIDENCE_HINT.best }, `melhor agora: confiança ${why.confidenceBest}`),
      " ",
      h("span", { class: "hint" }, why.kind === "mecânica" ? "só mecânica (sem dados de partidas)" : `mecânica + ${fmt(why.observed!.matches)} partidas`),
    ),
    why.observed ? observedLine(why.observed) : null,
    h(
      "details",
      { class: "why-details" },
      h("summary", {}, "Fontes, alternativa e incertezas"),
      why.alternative ? h("p", {}, `Alternativa com o mesmo orçamento: ${why.alternative.name} (jogadas ${why.alternative.deltaU >= 0 ? "+" : "−"}${fmt1(Math.abs(why.alternative.deltaU))} contra ${why.deltaU >= 0 ? "+" : "−"}${fmt1(Math.abs(why.deltaU))}).`) : null,
      why.parts.length ? h("p", {}, `De onde vem o ganho (repetindo a jogada sem cada efeito): ${why.parts.map((p) => `${p.label} ${p.value >= 0 ? "+" : "−"}${fmt1(Math.abs(p.value))}`).join("; ")}.`) : null,
      h("ul", {}, why.sources.map((s) => h("li", {}, s))),
      h("ul", { class: "uncertain" }, why.uncertainty.map((u) => h("li", {}, u))),
    ),
  );
}

const signedPp = (x: number) => `${x >= 0 ? "+" : "−"}${fmt1(Math.abs(x))} pp`;

/** O que as partidas dizem, no mesmo momento da compra (ou a média do herói, sem janela). */
function observedLine(o: NonNullable<Recommendation["observed"]>): HTMLElement {
  if (!o.window) return h("p", { class: "why-facts" }, `Partidas: ${signedPp(o.winrateDelta)} contra a média do herói, sem controlar o momento da compra.`);
  const vs = o.versusAlternative;
  return h(
    "p",
    { class: `why-facts${o.diverges ? " diverges" : ""}` },
    `Partidas, comprado aos ${o.window.window}: ${signedPp(o.window.delta)} ± ${fmt1(o.window.margin)} contra o que o herói compra nessa janela (${fmt(o.window.matches)} partidas).`,
    vs ? ` Contra ${vs.name}: ${signedPp(vs.diff)} ± ${fmt1(vs.margin)}${vs.significant ? "" : ", sem diferença clara"}.` : "",
    o.diverges ? " O modelo e as partidas apontam para lados opostos." : "",
  );
}

/** Jogadas da build final por tipo de luta (simulação), alternativas situacionais e regras da loja. */
function playPanel(app: App, result: OptimizeResult, input: OptimizeInput, plan: PlanId): HTMLElement {
  const ctx = { hero: result.hero, souls: result.souls, abilityTiers: result.abilityTiers, itemSlots: input.itemSlots, uptime: input.metric?.uptime, plan, ...(input.fights ? { fights: input.fights } : {}) };
  const { report } = buildPlay(app.data, ctx, result.items.map((i) => i.className));
  const situ = plan === "control" ? situationalOptions(app.data, ctx, result.items.map((i) => i.className), app.data.items.filter((i) => i.isActive && i.tier <= 4 && i.cost <= result.souls / 4)) : [];
  const issues = validateRoute(app.data, result, input.itemSlots ?? 9);
  return h(
    "section",
    { class: "plays" },
    h("h2", {}, "Jogadas da build"),
    h(
      "p",
      { class: "hint" },
      input.fights
        ? `Luta escolhida: ${input.fights.map((f) => SCENARIO_LABEL[f]).join(", ")}.`
        : app.data.fights
          ? `Mistura de lutas medida nas partidas: ${(Object.entries(scenarioMix()) as [ScenarioId, number][]).filter(([, w]) => w > 0).map(([id, w]) => `${SCENARIO_LABEL[id].toLowerCase()} ${Math.round(w * 100)}%`).join(", ")} (perseguição e iniciação com peso fixo).`
          : "Cenário assumido: mistura de duelo, lutas pequenas, teamfight, inimigos dispersos, perseguição e iniciação inimiga.",
    ),
    h(
      "ul",
      {},
      report.scenarios.map((s) => {
        const sim = s.best?.sim;
        const hits = sim ? Object.values(sim.hits).reduce((a, b) => a + b, 0) : 0;
        const esc = sim ? Object.values(sim.escaped).reduce((a, b) => a + b, 0) : 0;
        return h(
          "li",
          {},
          h("span", { class: "ability-name" }, s.label),
          h("span", {}, s.best ? s.best.steps.map((x, i) => (i === 0 ? x.name : `${x.name} (+${fmt1(x.at - s.best!.steps[i - 1]!.at)} s)`)).join(" → ") : "nenhuma jogada"),
          sim ? h("span", { class: "hint" }, `${hits} atingidos${esc ? `, ${esc} escapam` : ""}, ${fmt1(sim.control)} s de controle útil${sim.casterAlive ? "" : ", morre antes de concluir"}`) : null,
        );
      }),
    ),
    situ.length
      ? h(
          "div",
          {},
          h("h3", {}, "Trocas por tipo de luta"),
          h("ul", {}, situ.map((s) => h("li", {}, h("span", { class: "ability-name" }, s.label), h("span", {}, `${s.item.name}${s.replaces ? ` no lugar de ${s.replaces.item.name}` : ""}`), h("span", { class: "hint" }, `+${fmt1(s.gain)} nas jogadas por minuto (${s.mechanism})`)))),
        )
      : null,
    h("p", { class: "hint" }, issues.length ? `Atenção, a rota quebra regras da loja: ${issues.map((x) => `${x.item}: ${x.problem}`).join("; ")}.` : "Cada compra cabe nos souls, nos slots e no limite de ativos do momento; upgrades consomem o componente."),
  );
}

function bannedBar(app: App): HTMLElement | null {
  const { state } = app;
  if (state.banned.length === 0) return null;
  return h(
    "p",
    { class: "banned" },
    "Fora desta build: ",
    state.banned.map((name) =>
      h("button", { class: "chip chip-button", title: "Permitir de novo", onclick: () => app.update({ banned: state.banned.filter((n) => n !== name) }) }, `${name} ×`),
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
      h("td", { class: d.startsWith("+") || d === "novo" ? "up" : d.startsWith("−") ? "down" : "" }, d),
    );
  };
  return h(
    "table",
    { class: "metrics" },
    h("caption", {}, "O que a build muda"),
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Por segundo"), h("th", { scope: "col" }, "Sem itens"), h("th", { scope: "col" }, "Com a build"), h("th", { scope: "col" }, "Variação"))),
    h(
      "tbody",
      {},
      row("Dano total", b.totalDps, m.totalDps),
      row("Arma", b.weaponDps, m.weaponDps, false, true),
      row("Habilidades", b.abilityDps, m.abilityDps, false, true),
      row("Efeitos de itens", b.itemDps, m.itemDps, false, true),
      row("Corpo a corpo", b.meleeDps, m.meleeDps, false, true),
      ...(m.antiHealDps > 0 ? [row("Cura negada ao inimigo", b.antiHealDps, m.antiHealDps, false, true)] : []),
      row("Cura", b.sustain, m.sustain, true),
    ),
    h(
      "tbody",
      {},
      h("tr", { class: "gap" }, h("th", { scope: "col", colspan: 4 }, "Por minuto")),
      row("Controle (s)", b.control, m.control, true),
    ),
    h("tbody", {}, h("tr", { class: "gap" }, h("th", { scope: "col", colspan: 4 }, "No total")), row("Vida efetiva", b.ehp, m.ehp)),
  );
}

function abilityPlan(app: App, result: OptimizeResult): HTMLElement {
  const hero = findHero(app.data, result.hero);
  const abilities = heroAbilities(app.data, hero);
  return h(
    "section",
    { class: "abilities" },
    h("h2", {}, "Upgrades de habilidade"),
    h(
      "ul",
      {},
      abilities.map((a) => {
        const tier = result.abilityTiers[a.slot - 1] ?? 0;
        return h(
          "li",
          {},
          icon(a.image, a.name, "ability-icon"),
          h("span", { class: "ability-name" }, a.name),
          h(
            "span",
            { class: "pips", role: "img", "aria-label": `${tier} de 3 upgrades` },
            [1, 2, 3].map((t) => h("i", { class: t <= tier ? "pip on" : "pip" })),
          ),
        );
      }),
    ),
  );
}

function comparisonCard(c: BuildComparison, app: OptimizeResult): HTMLElement {
  const shared = new Set(c.shared.map((i) => i.className));
  const cm = c.result.metrics;
  const am = app.metrics;
  const cell = (label: string, theirs: number, ours: number) => h("tr", {}, h("th", { scope: "row" }, label), h("td", {}, fmt(theirs)), h("td", {}, fmt(ours)));
  const v = c.result.vitality;
  const spikeNote = v?.reachedAt != null ? ` Pico de vitality por volta do minuto ${Math.round(v.reachedMinute ?? 0)}.` : " Não chega ao pico de vitality com esses souls.";
  return h(
    "li",
    { class: "compare-card" },
    h("h3", {}, c.build.name || "Build sem nome"),
    h("p", { class: "buy-meta" }, `${fmt(c.build.matches)} partidas, ${fmt1(c.winrate * 100)}% de vitória.${spikeNote}`),
    h(
      "ul",
      { class: "compare-items", "aria-label": "Itens da build publicada até esses souls" },
      c.items.map((i) =>
        h("li", { class: shared.has(i.className) ? "in-both" : "", title: `${i.name}${shared.has(i.className) ? " (também na build do app)" : ""}` }, icon(i.image, i.name, `item-icon small buy-${i.slot}`)),
      ),
    ),
    h(
      "table",
      { class: "metrics compact" },
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Pelo motor"), h("th", { scope: "col" }, "Publicada"), h("th", { scope: "col" }, "App"))),
      h("tbody", {}, cell("Dano total/s", cm.totalDps, am.totalDps), cell("Vida efetiva", cm.ehp, am.ehp), cell("Pontos", c.result.score * 100, app.score * 100)),
    ),
    h("p", { class: "hint" }, c.onlyApp.length ? `Só no app: ${c.onlyApp.map((i) => i.name).join(", ")}.` : "Todos os itens do app estão nesta build."),
  );
}

function comparison(app: App, result: OptimizeResult, input: OptimizeInput): HTMLElement | null {
  const meta = heroMeta(app.data, findHero(app.data, input.hero).id);
  if (!meta) return null;
  const cards = compareWithPopular(app.data, result, input);
  const best = [...powerWindows(meta)].sort((a, b) => b.winrate - a.winrate)[0];
  const window = best ? ` ${input.hero} vence mais em partidas de ${best.bucket.fromMin}${best.bucket.toMin ? ` a ${best.bucket.toMin}` : "+"} minutos (${fmt1(best.winrate * 100)}% de vitória).` : "";
  return h(
    "section",
    { class: "compare" },
    h("h2", {}, "Comparado com as builds mais jogadas"),
    h(
      "p",
      { class: "hint" },
      `Builds publicadas no jogo com mais partidas nos últimos ${app.data.stats!.days} dias, cortadas nos mesmos souls e medidas pelo mesmo motor. Ícones com borda clara também estão na build do app.${window}`,
    ),
    cards.length ? h("ol", { class: "compare-list" }, cards.map((c) => comparisonCard(c, result))) : h("p", { class: "empty" }, "Nenhuma build publicada tem itens que caibam nesses souls."),
  );
}

/** No objetivo "Otimizada", diz qual vida efetiva mínima foi exigida e se a build chegou lá. */
function defenseNote(result: OptimizeResult): string {
  const floor = result.weights.ehpFloor;
  if (!floor) return "";
  const target = floor * result.baseline.ehp;
  const ok = result.metrics.ehp >= target * 0.99;
  return ` Defesa mínima: ${fmt(target)} de vida efetiva, a das builds mais jogadas com esses souls${ok ? "" : `; esta build fica em ${fmt(result.metrics.ehp)}`}.`;
}

/** Explica quanto os efeitos "ao acertar melee" valem para este herói, e de onde vem o número. */
function meleeNote(app: App, result: OptimizeResult, heroId: number): string {
  const share = Math.round(result.build.meleeShare * 100);
  const rate = meleePickRate(app.data, heroId);
  const source =
    rate === null
      ? "Sem estatísticas do herói, o motor assume 50%."
      : `Vem das partidas: os jogadores de ${result.hero} compram itens de melee (Spirit Snatch, Lifestrike, Melee Charge...) em ${Math.round(rate * 100)}% das partidas, em média.`;
  return `Efeitos de corpo a corpo valem ${share}% para ${result.hero}. ${source}`;
}

/** De onde vem o controle da build, em segundos por minuto. */
function controlPanel(app: App, result: OptimizeResult): HTMLElement {
  const sources = controlBreakdown(result.build, { ...DEFAULT_METRIC_OPTIONS, uptime: app.state.uptime });
  return h(
    "section",
    { class: "control-sources" },
    h("h2", {}, "De onde vem o controle"),
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
      : h("p", { class: "empty" }, "Nenhuma habilidade ou item desta build aplica controle."),
    h(
      "p",
      { class: "hint" },
      "Um segundo de stun vale 1; imobilizar e sono, 0,8; silêncio e hex, 0,6; desarme, 0,5; prender, 0,4; lentidão vale pela força (30% de slow conta 0,15). Assume que a habilidade acerta a cada cooldown.",
    ),
  );
}

export function renderBuildView(app: App): HTMLElement {
  const { state, data } = app;
  const hero = findHero(data, state.hero);
  const objective = objectiveFor(app);
  const input: OptimizeInput = {
    hero: state.hero,
    objective,
    souls: state.souls,
    itemSlots: state.slots,
    required: state.required,
    banned: state.banned,
    metric: { uptime: state.uptime },
    ...(state.vitalitySpike ? {} : { vitalitySpike: false as const }),
    mode: state.progressive === false ? "final" : "progressive",
    explain: true,
  };
  const result = optimize(data, input);
  const plan: PlanId = result.weights.play ? "control" : "damage";
  const progression = progressionFromSouls(data.shared, state.souls);

  const main = h(
    "main",
    { class: "result" },
    h(
      "header",
      { class: "result-head" },
      icon(hero.image, hero.name, "portrait portrait-big"),
      h(
        "div",
        {},
        h("h1", {}, objective === "optimized" ? `${hero.name}, build otimizada` : `${hero.name}, build de ${OBJECTIVE_LABEL[objective].name.toLowerCase()}`),
        h(
          "p",
          {},
          `Nível ${progression.level} com ${fmt(state.souls)} souls. ${result.items.length} ${result.items.length === 1 ? "item" : "itens"} em ${state.slots} slots, ${fmt1(result.score)}× a pontuação do herói sem itens.${defenseNote(result)}`,
        ),
      ),
    ),
    soulTrack(result),
    finalBuild(result, state.slots),
    h(
      "div",
      { class: "columns" },
      h("section", { class: "order" }, h("h2", {}, "Ordem de compra"), bannedBar(app), purchaseList(app, result, hero.id)),
      h(
        "div",
        { class: "side" },
        metricsTable(result.metrics, result.baseline),
        h("p", { class: "hint" }, meleeNote(app, result, hero.id)),
        objective === "control" ? controlPanel(app, result) : null,
        playPanel(app, result, input, plan),
        abilityPlan(app, result),
        h(
          "p",
          { class: "caveat" },
          "Os números são estimativas para comparar builds do mesmo herói. Dano de habilidade assume uso a cada cooldown; dano de efeitos de itens é o menos preciso. Confira no sandbox antes de confiar.",
        ),
      ),
    ),
    theoriesSection(app, hero.id),
    comparison(app, result, input),
  );

  return h("div", { class: "layout" }, controls(app), main);
}
