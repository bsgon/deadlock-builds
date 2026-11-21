import type { GameData } from "../src/data/types.ts";
import { withoutBrawlItems } from "../src/data/playable.ts";
import { buildGraph, type Graph } from "../src/interactions/synergy.ts";
import { applyFightProfile, type Objective } from "../src/optimizer/metrics.ts";
import { BuildClient } from "./build-client.ts";
import { renderBuildView } from "./build-view.ts";
import { h } from "./dom.ts";
import { renderSynergyView } from "./synergy-view.ts";

export interface State {
  tab: "build" | "synergy";
  hero: string;
  objective: Objective;
  /** Título do arquétipo da comunidade escolhido ("" = livre). */
  archetype: string;
  required: string[];
  banned: string[];
  /** Monta a build compra a compra, como na partida (false: melhor build final, depois a ordem). */
  progressive: boolean;
  /** Item em foco no explorador de sinergias. */
  item: string;
  /** Tipo de luta esperado nas jogadas simuladas ("mix" = não sei, cenário assumido). */
}

export interface App {
  data: GameData;
  graph: Graph;
  state: State;
  /** Cálculo das builds fora da thread principal, com cache por configuração. */
  builds: BuildClient;
  /** Atualiza o estado, salva e redesenha. */
  update(patch: Partial<State>): void;
  /** Redesenha sem mudar o estado (quando chega um resultado do worker). */
  refresh(): void;
}

const STORAGE_KEY = "deadlock-builds:state";
const DEFAULTS: State = { tab: "build", hero: "Infernus", objective: "optimized", archetype: "", progressive: true, required: [], banned: [], item: "Mystic Vulnerability" };
/** Objetivos que não aparecem mais no seletor voltam para o padrão. */
const RETIRED_OBJECTIVES: Objective[] = ["dps"];

function loadState(data: GameData): State {
  let saved: Partial<State> = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    // Sem armazenamento ou conteúdo inválido: segue com o padrão.
  }
  const state = { ...DEFAULTS, ...saved };
  if (RETIRED_OBJECTIVES.includes(state.objective)) state.objective = DEFAULTS.objective;
  // Um patch pode remover heróis ou itens salvos.
  const itemNames = new Set(data.items.map((i) => i.name));
  if (!data.heroes.some((h) => h.name === state.hero)) state.hero = data.heroes[0]!.name;
  if (!itemNames.has(state.item)) state.item = data.items[0]!.name;
  state.required = state.required.filter((n) => itemNames.has(n));
  state.banned = state.banned.filter((n) => itemNames.has(n));
  return state;
}

async function loadData(): Promise<GameData> {
  // Na versão publicada como artefato, os dados vêm embutidos na própria página.
  const embedded = document.getElementById("snapshot");
  if (embedded?.textContent) return withoutBrawlItems(JSON.parse(embedded.textContent) as GameData);
  const get = async (file: string) => {
    const res = await fetch(`./${file}`);
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    return res.json();
  };
  const [meta, shared, heroes, abilities, items] = await Promise.all(["meta.json", "shared.json", "heroes.json", "abilities.json", "items.json"].map(get));
  // stats.json é opcional: sem ele o app funciona, só sem a comparação com builds reais.
  const stats = await fetch("./stats.json")
    .then((res) => (res.ok ? res.json() : undefined))
    .catch(() => undefined);
  const knowledge = await fetch("./interactions.json")
    .then((res) => (res.ok ? res.json() : undefined))
    .catch(() => undefined);
  const theories = await fetch("./theories.json")
    .then((res) => (res.ok ? res.json() : undefined))
    .catch(() => undefined);
  const windows = await fetch("./windows.json")
    .then((res) => (res.ok ? res.json() : undefined))
    .catch(() => undefined);
  const fights = await fetch("./fights.json")
    .then((res) => (res.ok ? res.json() : undefined))
    .catch(() => undefined);
  return withoutBrawlItems({ meta, shared, heroes, abilities, items, ...(stats ? { stats } : {}), ...(knowledge ? { knowledge } : {}), ...(theories ? { theories } : {}), ...(windows ? { windows } : {}), ...(fights ? { fights } : {}) });
}

const root = document.getElementById("app")!;

function render(app: App): void {
  const { state, data } = app;
  const tab = (id: State["tab"], label: string) =>
    h("button", { class: "tab", role: "tab", "aria-selected": String(state.tab === id), onclick: () => app.update({ tab: id }) }, label);

  const header = h(
    "header",
    { class: "masthead" },
    h("p", { class: "brand" }, "Livro de Souls"),
    h("nav", { class: "tabs", role: "tablist", "aria-label": "Seções" }, tab("build", "Montar build"), tab("synergy", "Explorar sinergias")),
    h("p", { class: "patch" }, `Dados do patch ${data.meta.clientVersion}, de ${data.meta.versionDate ?? "data desconhecida"}`),
  );
  const view = state.tab === "build" ? renderBuildView(app) : renderSynergyView(app);
  const footer = h(
    "footer",
    { class: "colophon" },
    "Ferramenta de fã, sem vínculo com a Valve. Dados e imagens do jogo vêm do ",
    h("a", { href: "https://deadlock-api.com", target: "_blank", rel: "noopener" }, "deadlock-api.com"),
    ".",
  );
  root.replaceChildren(header, view, footer);
}

try {
  const data = await loadData();
  // Duração e tipos de luta medidos nas partidas valem para todo o cálculo.
  applyFightProfile(data.fights);
  const app: App = {
    data,
    graph: buildGraph(data),
    state: loadState(data),
    builds: new BuildClient(data),
    update(patch) {
      Object.assign(app.state, patch);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(app.state));
      } catch {
        // Armazenamento indisponível: a sessão continua funcionando.
      }
      render(app);
    },
    refresh() {
      render(app);
    },
  };
  render(app);
} catch (err) {
  root.replaceChildren(
    h(
      "div",
      { class: "failure" },
      h("h1", {}, "Os dados do jogo não carregaram"),
      h("p", {}, `Motivo: ${(err as Error).message}. Rode "npm run snapshot" na pasta do projeto para baixar os dados e recarregue a página.`),
    ),
  );
}
