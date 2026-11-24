/**
 * Um só mouse-over para a página inteira: abre por mouse, foco do teclado ou toque,
 * fecha com Esc, rolagem ou toque fora, e nunca sai da tela. Quem redesenha a página
 * chama `hideTip()`, porque o elemento que o abriu deixa de existir.
 */
import type { Ability, Item } from "../src/data/types.ts";
import { findHero } from "../src/engine/index.ts";
import { tr } from "../src/i18n.ts";
import { h, icon } from "./dom.ts";
import type { App } from "./main.ts";
import { abilityTip, itemTip, type TipContent } from "./tip-content.ts";

const TIP_ID = "tip";
const MARGIN = 8;
let box: HTMLElement | null = null;
let anchor: HTMLElement | null = null;

function tipBox(): HTMLElement {
  if (box) return box;
  box = h("div", { id: TIP_ID, class: "tip", role: "tooltip", hidden: true });
  document.body.append(box);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") hideTip();
  });
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", hideTip);
  document.addEventListener("pointerdown", (ev) => {
    if (anchor && !(ev.target instanceof Node && anchor.contains(ev.target))) hideTip();
  });
  return box;
}

/** Rolar fecha, menos quando foi o Tab que rolou até o elemento em foco: aí acompanha. */
function onScroll(): void {
  if (anchor && anchor === document.activeElement && anchor.matches(":focus-visible")) placeTip(anchor);
  else hideTip();
}

export function hideTip(): void {
  if (!anchor) return;
  anchor.removeAttribute("aria-describedby");
  anchor = null;
  tipBox().hidden = true;
}

function showTip(el: HTMLElement, body: () => HTMLElement): void {
  if (anchor === el) return;
  hideTip();
  const tip = tipBox();
  tip.replaceChildren(body());
  tip.hidden = false;
  anchor = el;
  el.setAttribute("aria-describedby", TIP_ID);
  placeTip(el);
}

function placeTip(el: HTMLElement): void {
  const tip = tipBox();
  // Mede do canto: perto da borda direita a caixa encolheria.
  tip.style.left = tip.style.top = "0";
  const at = el.getBoundingClientRect();
  const { width, height } = tip.getBoundingClientRect();
  const { clientWidth, clientHeight } = document.documentElement;
  const left = Math.max(MARGIN, Math.min(at.left + at.width / 2 - width / 2, clientWidth - width - MARGIN));
  // Embaixo se couber; senão em cima; sem espaço em nenhum dos dois, encosta na borda de baixo.
  const below = at.bottom + MARGIN;
  const above = at.top - MARGIN - height;
  const top = below + height <= clientHeight - MARGIN ? below : above >= MARGIN ? above : Math.max(MARGIN, clientHeight - height - MARGIN);
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

/** Liga o mouse-over a um elemento. O conteúdo só é montado quando abre. */
export function withTip<T extends HTMLElement>(el: T, body: () => HTMLElement): T {
  let touch = false;
  el.addEventListener("pointerenter", (ev) => {
    if (ev.pointerType === "mouse") showTip(el, body);
  });
  el.addEventListener("pointerleave", (ev) => {
    if (ev.pointerType === "mouse" && anchor === el) hideTip();
  });
  el.addEventListener("pointerdown", (ev) => {
    touch = ev.pointerType !== "mouse";
  });
  // Toque abre e fecha no clique (o pointerdown também começa uma rolagem).
  el.addEventListener("click", () => {
    if (!touch) return;
    touch = false;
    if (anchor === el) hideTip();
    // Botão que redesenha a página ao ser tocado já saiu do documento.
    else if (el.isConnected) showTip(el, body);
  });
  el.addEventListener("focus", () => {
    if (!touch && el.matches(":focus-visible")) showTip(el, body);
  });
  el.addEventListener("blur", () => {
    if (anchor === el) hideTip();
  });
  return el;
}

/** Desenha o conteúdo de um mouse-over. */
export function tipBody(c: TipContent): HTMLElement {
  return h(
    "div",
    {},
    h("p", { class: "tip-title" }, c.title),
    c.meta ? h("p", { class: "tip-meta" }, c.meta) : null,
    c.sections.map((s) =>
      h(
        "div",
        { class: "tip-section" },
        s.title ? h("p", { class: "tip-label" }, s.title) : null,
        s.text ? h("p", {}, s.text) : null,
        s.stats?.length ? h("dl", {}, s.stats.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))) : null,
      ),
    ),
    c.footer ? h("p", { class: "tip-footer" }, c.footer) : null,
  );
}

/** Botão "i" com um texto explicativo só no mouse-over (foco e toque também abrem). */
export const infoTip = (title: string, ...texts: string[]): HTMLElement =>
  withTip(h("button", { class: "info", type: "button", "aria-label": tr(`Sobre: ${title}`, `About: ${title}`) }, "i"), () => tipBody({ title, sections: texts.filter(Boolean).map((text) => ({ text })) }));

/** Na aba de sinergias não há herói em foco, então não há taxa de compra. */
const heroIdOf = (app: App) => (app.state.tab === "build" ? findHero(app.data, app.state.hero).id : null);

export const withItemTip = <T extends HTMLElement>(app: App, item: Item, el: T): T => withTip(el, () => tipBody(itemTip(app.data, heroIdOf(app), item)));

/** Deixa um ícone decorativo focável e com nome, para o mouse-over abrir pelo teclado. */
function focusable(el: HTMLElement, name: string): HTMLElement {
  el.removeAttribute("aria-hidden");
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", name);
  el.tabIndex = 0;
  return el;
}

/** Ícone de item com mouse-over. */
export const itemIcon = (app: App, item: Item, cls: string): HTMLElement => withItemTip(app, item, focusable(icon(item.image, item.name, cls), item.name));

/** Ícone de habilidade com mouse-over. */
export const abilityIcon = (ability: Ability, cls: string): HTMLElement => withTip(focusable(icon(ability.image, ability.name, cls), ability.name), () => tipBody(abilityTip(ability)));
