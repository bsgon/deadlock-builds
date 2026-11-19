/** Utilitários mínimos de DOM para a interface (sem framework). */

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | ((ev: Event) => void)>;

/** Cria um elemento: h("button", { class: "x", onclick: fn }, "texto"). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === "function") el.addEventListener(key.replace(/^on/, ""), value);
    else if (value === true) el.setAttribute(key, "");
    else el.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmt = (n: number) => number.format(n);
export const fmt1 = (n: number) => decimal.format(n);

/** Variação percentual em relação à referência, com sinal. */
export function delta(now: number, base: number): string {
  if (base <= 0.5) return now > 0.5 ? "novo" : "igual";
  const pct = (now / base - 1) * 100;
  if (Math.abs(pct) < 0.5) return "igual";
  return `${pct > 0 ? "+" : "−"}${number.format(Math.abs(pct))}%`;
}

/** Ícone com fallback: se a imagem não carregar, mostra as iniciais. */
export function icon(src: string | null, name: string, cls: string): HTMLElement {
  const initials = name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2);
  const box = h("span", { class: `icon ${cls}`, "aria-hidden": "true" }, initials);
  if (src) {
    // Sem loading="lazy": a imagem é criada fora do documento e só entra depois de carregar.
    const img = h("img", { alt: "", decoding: "async" });
    img.addEventListener("load", () => box.replaceChildren(img));
    img.src = src;
    // Sem listener de erro: as iniciais continuam no lugar.
  }
  return box;
}
