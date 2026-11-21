import type { Item, Slot } from "../src/data/types.ts";
import { findItem } from "../src/engine/index.ts";
import { heroesForItem, partnersByTree, topLinks, topReasons, type Partner } from "../src/interactions/synergy.ts";
import { reasonItem } from "./build-view.ts";
import { fmt, fmt1, h, icon } from "./dom.ts";
import type { App } from "./main.ts";
import { tr } from "../src/i18n.ts";

const slotLabel = (): Record<Slot, string> => ({ weapon: tr("Arma", "Weapon"), vitality: tr("Vitalidade", "Vitality"), spirit: "Spirit" });
const SLOTS: Slot[] = ["weapon", "vitality", "spirit"];

function picker(app: App, selected: Item): HTMLElement {
  const list = h("div", { class: "pick-list" });
  const draw = (query: string) => {
    const q = query.trim().toLowerCase();
    list.replaceChildren(
      ...SLOTS.map((slot) => {
        const items = app.data.items.filter((i) => i.slot === slot && (!q || i.name.toLowerCase().includes(q)));
        if (items.length === 0) return null;
        return h(
          "section",
          {},
          h("h3", {}, slotLabel()[slot]),
          h(
            "ul",
            {},
            items.map((item) =>
              h(
                "li",
                {},
                h(
                  "button",
                  { class: `pick pick-${slot}`, "aria-current": String(item.name === selected.name), onclick: () => app.update({ item: item.name }) },
                  icon(item.image, item.name, "item-icon small"),
                  h("span", {}, item.name),
                  h("span", { class: "cost" }, fmt(item.cost)),
                ),
              ),
            ),
          ),
        );
      }).filter((n) => n !== null),
    );
    if (!list.hasChildNodes()) list.append(h("p", { class: "empty" }, tr(`Nenhum item com “${query}”. Tente parte do nome em inglês.`, `No item matching “${query}”. Try part of the name.`)));
  };
  draw("");
  return h(
    "aside",
    { class: "controls", "aria-label": tr("Escolha de item", "Item picker") },
    h("h2", {}, h("label", { for: "item-search" }, "Item")),
    h("input", { id: "item-search", type: "search", placeholder: tr("Buscar por nome", "Search by name"), oninput: (ev) => draw((ev.target as HTMLInputElement).value) }),
    list,
  );
}

export function renderSynergyView(app: App): HTMLElement {
  const item = findItem(app.data, app.state.item);
  const byTree = partnersByTree(app.graph, item, 5);
  // Outras árvores primeiro: são as combinações menos óbvias.
  const trees = [...SLOTS.filter((s) => s !== item.slot), item.slot].filter((s) => byTree[s].length > 0);
  const heroes = heroesForItem(app.graph, item).slice(0, 12);
  const effect = [...item.sections.filter((s) => s.type !== "innate").map((s) => s.text), item.text].find((t) => t) ?? tr("Só concede atributos, sem efeito especial.", "Only grants stats, no special effect.");

  const partnerItem = (p: Partner) =>
    h(
      "li",
      { class: `buy buy-${p.item.slot}` },
      icon(p.item.image, p.item.name, "item-icon"),
      h(
        "div",
        { class: "buy-main" },
        h("h3", {}, h("button", { class: "link name", onclick: () => app.update({ item: p.item.name }) }, p.item.name)),
        h("p", { class: "buy-meta" }, `Tier ${p.item.tier}, ${fmt(p.item.cost)} souls.`),
        h("ul", { class: "reasons" }, topLinks(p.links, 2).map(reasonItem)),
      ),
      h("div", { class: "buy-side" }, h("span", { class: "gain", title: tr("Força da combinação (heurística)", "Combination strength (heuristic)") }, fmt1(p.score))),
    );
  const partnerList = trees.length
    ? trees.map((slot) =>
        h(
          "section",
          { class: "tree-group" },
          h("h3", { class: `tree-title tree-${slot}` }, slot === item.slot ? tr(`Mesma árvore (${slotLabel()[slot]})`, `Same tree (${slotLabel()[slot]})`) : slotLabel()[slot]),
          h("ol", { class: "buys" }, byTree[slot].map(partnerItem)),
        ),
      )
    : [h("p", { class: "empty" }, tr("Este item não tem combinação direta com outros: ele só concede atributos ou depende do kit do herói.", "This item has no direct combination with others: it only grants stats or depends on the hero's kit."))];

  const heroList = heroes.length
    ? h(
        "ul",
        { class: "hero-fits" },
        heroes.map((f) =>
          h(
            "li",
            {},
            h(
              "button",
              { class: "hero-fit", title: tr(`Montar build de ${f.hero.name}`, `Build ${f.hero.name}`), onclick: () => app.update({ tab: "build", hero: f.hero.name, required: [item.name], banned: [] }) },
              icon(f.hero.image, f.hero.name, "portrait"),
              h("span", {}, h("strong", {}, f.hero.name), h("small", {}, topReasons(f.links, 1)[0] ?? "")),
            ),
          ),
        ),
      )
    : h("p", { class: "empty" }, tr("Nenhum kit aproveita este item de forma específica.", "No kit makes specific use of this item."));

  const main = h(
    "main",
    { class: "result" },
    h(
      "header",
      { class: "result-head" },
      icon(item.image, item.name, `item-icon big buy-${item.slot}`),
      h("div", {}, h("h1", {}, item.name), h("p", {}, `${slotLabel()[item.slot]}, tier ${item.tier}, ${fmt(item.cost)} souls. ${effect}`)),
    ),
    h(
      "div",
      { class: "columns" },
      h("section", { class: "order" }, h("h2", {}, tr("Itens que combinam", "Items that combine")), ...partnerList),
      h(
        "div",
        { class: "side" },
        h("section", {}, h("h2", {}, tr("Heróis que mais aproveitam", "Heroes that benefit most")), h("p", { class: "hint" }, tr("Escolha um herói para montar a build com este item fixado.", "Pick a hero to build with this item locked.")), heroList),
        h("p", { class: "caveat" }, tr("A força das combinações é uma heurística baseada em etiquetas dos efeitos, não em dano medido.", "Combination strength is a heuristic based on effect tags, not measured damage.")),
      ),
    ),
  );
  return h("div", { class: "layout" }, picker(app, item), main);
}
