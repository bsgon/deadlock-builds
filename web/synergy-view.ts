import type { Item, Slot } from "../src/data/types.ts";
import { findItem } from "../src/engine/index.ts";
import { heroesFor, type HeroUse } from "../src/knowledge/hero-combos.ts";
import { fmt, fmt1, h, icon } from "./dom.ts";
import type { App } from "./main.ts";
import { tr } from "../src/i18n.ts";
import { combosOf, COMBO_KINDS, comboText, unexplainedPartners, type ComboKind, type ComboView, type PairEvidence } from "../src/knowledge/item-combos.ts";
import { itemIcon, withItemTip } from "./tooltip.ts";

const slotLabel = (): Record<Slot, string> => ({ weapon: tr("Arma", "Weapon"), vitality: tr("Vitalidade", "Vitality"), spirit: "Spirit" });
const SLOTS: Slot[] = ["weapon", "vitality", "spirit"];

const kindLabel = (): Record<ComboKind, [string, string]> => ({
  setup: [tr("Prepara", "Sets it up"), tr("Vem antes do T4 e cria a chance de usá-lo bem.", "Comes before the T4 and creates the opening.")],
  payoff: [tr("Aproveita", "Pays it off"), tr("Vem depois do T4 e usa o que ele criou.", "Comes after the T4 and uses what it created.")],
  trigger: [tr("Aciona", "Triggers it"), tr("O efeito de um liga ou alimenta o do outro.", "One effect turns on or feeds the other.")],
  amplify: [tr("Amplifica", "Amplifies it"), tr("Faz o efeito do T4 durar, alcançar ou bater mais.", "Makes the T4's effect last longer, reach farther or hit harder.")],
  cover: [tr("Cobre a fraqueza", "Covers the weakness"), tr("Protege onde o T4 deixa você exposto.", "Protects where the T4 leaves you exposed.")],
});
const strengthLabel = (): Record<1 | 2 | 3, string> => ({ 1: tr("Ajuda", "Helps"), 2: tr("Forte", "Strong"), 3: tr("Principal", "Core") });

function evidenceText(e: PairEvidence, partner: string, t4: string): string {
  const rate = e.rate < 0.01 ? "<1%" : `${Math.round(e.rate * 100)}%`;
  const lift = fmt1(e.lift);
  return tr(`${rate} de quem compra ${t4} também compra ${partner}: ${lift}× o esperado.`, `${rate} of ${t4} buyers also buy ${partner}: ${lift}× expected.`);
}

function usageText(u: HeroUse): string {
  if (u.rate === null || u.lift === null) return "";
  const rate = u.rate < 0.01 ? "<1%" : `${Math.round(u.rate * 100)}%`;
  return tr(`Compra em ${rate} das partidas, ${fmt1(u.lift)}× a média dos heróis.`, `Bought in ${rate} of matches, ${fmt1(u.lift)}× the hero average.`);
}

function picker(app: App, selected: Item): HTMLElement {
  const list = h("div", { class: "pick-list" });
  const draw = (query: string) => {
    const q = query.trim().toLowerCase();
    list.replaceChildren(
      ...SLOTS.map((slot) => {
        const items = app.data.items.filter((i) => i.tier === 4 && i.slot === slot && (!q || i.name.toLowerCase().includes(q)));
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
                withItemTip(app, item, h(
                  "button",
                  { class: `pick pick-${slot}`, "aria-current": String(item.name === selected.name), onclick: () => app.update({ item: item.name }) },
                  icon(item.image, item.name, "item-icon small"),
                  h("span", {}, item.name),
                  h("span", { class: "cost" }, fmt(item.cost)),
                )),
              ),
            ),
          ),
        );
      }).filter((n) => n !== null),
    );
    if (!list.hasChildNodes()) list.append(h("p", { class: "empty" }, tr(`Nenhum T4 com “${query}”. Tente parte do nome em inglês.`, `No T4 matching “${query}”. Try part of the name.`)));
  };
  draw("");
  return h(
    "aside",
    { class: "controls", "aria-label": tr("Escolha de item", "Item picker") },
    h("h2", {}, h("label", { for: "item-search" }, tr("Item T4", "T4 item"))),
    h("input", { id: "item-search", type: "search", placeholder: tr("Buscar por nome", "Search by name"), oninput: (ev) => draw((ev.target as HTMLInputElement).value) }),
    list,
  );
}

export function renderSynergyView(app: App): HTMLElement {
  const item = findItem(app.data, app.state.item);
  const isT4 = item.tier === 4;
  const combos = combosOf(app.data, item);
  const kinds = COMBO_KINDS.filter((k) => combos.some((c) => c.combo.kind === k));
  const others = isT4 ? unexplainedPartners(app.data, item) : [];
  const heroes = heroesFor(app.data, item);
  const effect = [...item.sections.filter((s) => s.type !== "innate").map((s) => s.text), item.text].find((t) => t) ?? tr("Só concede atributos, sem efeito especial.", "Only grants stats, no special effect.");

  const comboItem = (view: ComboView) => {
    const other = isT4 ? view.partner : view.t4;
    return h(
      "li",
      { class: `buy combo buy-${other.slot}` },
      itemIcon(app, other, "item-icon"),
      h(
        "div",
        { class: "buy-main" },
        h("h3", {}, h("button", { class: "link name", onclick: () => app.update({ item: other.name }) }, other.name)),
        h("p", { class: "buy-meta" }, `Tier ${other.tier}, ${fmt(other.cost)} souls${other.isActive ? tr(", ativo", ", active") : ""}.`),
        h("p", { class: "combo-text" }, comboText(view.combo)),
        view.evidence ? h("p", { class: "buy-meta" }, evidenceText(view.evidence, view.partner.name, view.t4.name)) : null,
      ),
      h("div", { class: "buy-side" }, h("span", { class: "gain" }, strengthLabel()[view.combo.strength])),
    );
  };
  const comboList = combos.length
    ? kinds.map((kind) =>
        h(
          "section",
          { class: "tree-group" },
          h("h3", { class: "tree-title" }, kindLabel()[kind][0]),
          h("p", { class: "hint" }, kindLabel()[kind][1]),
          h("ul", { class: "buys" }, combos.filter((c) => c.combo.kind === kind).map(comboItem)),
        ),
      )
    : [h("p", { class: "empty" }, isT4 ? tr("Este T4 ainda não foi analisado.", "This T4 has not been analyzed yet.") : tr("Nenhum T4 tem este item entre os combos principais.", "No T4 lists this item among its main combos."))];
  const otherList = others.length
    ? h(
        "section",
        {},
        h("h2", {}, tr("Também comprados juntos", "Also bought together")),
        h("p", { class: "hint" }, tr("Sem combo direto conhecido: pode ser só o mesmo estilo de build.", "No known direct combo: may just be the same build style.")),
        h(
          "ul",
          {},
          others.map((o) =>
            h(
              "li",
              { class: "combo-other" },
              itemIcon(app, o.item, "item-icon small"),
              h("span", {}, h("button", { class: "link name", onclick: () => app.update({ item: o.item.name }) }, o.item.name), h("small", {}, evidenceText(o.evidence, o.item.name, item.name))),
            ),
          ),
        ),
      )
    : null;

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
              h("span", {}, h("strong", {}, f.hero.name), f.reason ? h("small", { class: "fit-reason" }, f.reason) : null, h("small", {}, usageText(f))),
            ),
          ),
        ),
      )
    : h("p", { class: "empty" }, tr("Nenhum herói compra este item bem acima da média.", "No hero buys this item well above average."));

  const main = h(
    "main",
    { class: "result" },
    h(
      "header",
      { class: "result-head" },
      itemIcon(app, item, `item-icon big buy-${item.slot}`),
      h("div", {}, h("h1", {}, item.name), h("p", {}, `${slotLabel()[item.slot]}, tier ${item.tier}, ${fmt(item.cost)} souls. ${effect}`)),
    ),
    h(
      "div",
      { class: "columns" },
      h(
        "section",
        { class: "order" },
        h("h2", {}, isT4 ? tr("T3 e T2 que combinam", "T3 and T2 that combine") : tr("T4 em que este item entra", "T4 items this one goes with")),
        ...comboList,
      ),
      h(
        "div",
        { class: "side" },
        h("section", {}, h("h2", {}, tr("Heróis que mais aproveitam", "Heroes that benefit most")), h("p", { class: "hint" }, tr("Escolha um herói para montar a build com este item fixado.", "Pick a hero to build with this item locked.")), heroList),
        otherList,
        h("p", { class: "caveat" }, tr(
          "Os combos vêm da leitura dos efeitos de cada item. “Vezes o esperado” compara com jogadores do mesmo herói e com souls parecidos; mostra o que é comprado junto, não que vence mais.",
          "Combos come from reading each item's effects. “Times expected” compares with players on the same hero with similar souls; it shows what is bought together, not what wins more.",
        )),
      ),
    ),
  );
  return h("div", { class: "layout" }, picker(app, item), main);
}
