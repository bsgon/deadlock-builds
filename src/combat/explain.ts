/**
 * Por que comprar isto agora: ΔU = U(depois) − U(antes) no mesmo contexto,
 * comparado com a alternativa de mesmo orçamento, com a parte do ganho que vem
 * de cada efeito de preparo (repetindo a simulação sem só aquele efeito) e a
 * parte que vem de sobreviver para executar.
 *
 * Tudo é calculado em código; o texto só descreve o resultado. Sem estatísticas
 * de partidas, a recomendação sai marcada como "mecânica".
 */
import type { GameData, Item } from "../data/types.ts";
import { evaluateBuild, type BuildResult } from "../engine/index.ts";
import { tr } from "../i18n.ts";
import { heroMeta, minuteForSouls } from "../meta/stats.ts";
import { compareInWindow, windowStat, type WindowStat } from "../meta/windows.ts";
import { itemWpa, type ItemWpa } from "../meta/wpa.ts";
import { effectiveHealth } from "../optimizer/defense.ts";
import { buildEffects, type EffectDef } from "./effects.ts";
import { discoverInteractions, familyFor, FAMILY_LABEL, type Family } from "./interactions.ts";
import { staleSources } from "./mechanics.ts";
import type { Scenario } from "./sim.ts";
import { playReport, PLANS, SCENARIO_LABEL, type PlanId, type PlayReport, type ScenarioId, type SequenceResult } from "./value.ts";

export type Confidence = "alta" | "média" | "baixa";

export interface GainPart {
  label: string;
  family: Family | null;
  /** Parte do ΔU (mesma unidade de U). */
  value: number;
}

export interface Observed {
  matches: number;
  /**
   * Winrate com o item menos a referência, em pontos percentuais. Com dados por janela,
   * a referência são as compras do herói na mesma janela de minutos; sem eles, a média do herói.
   */
  winrateDelta: number;
  buyMinute: number;
  /** Comparação na janela de compra (mesmo momento da partida), quando há amostra. */
  window: WindowStat | null;
  /** Item contra a alternativa na mesma janela: diferença de winrate e intervalo de 95%. */
  versusAlternative: { name: string; diff: number; margin: number; significant: boolean } | null;
  /** O modelo e as partidas apontam lados opostos (diferença fora do intervalo). */
  diverges: boolean;
  /** Vitória acima do esperado pelo estado da partida na hora da compra (wpa.json), quando existe. */
  wpa: ItemWpa | null;
  notes: string[];
}

export interface Recommendation {
  purchase: string;
  plan: PlanId;
  deltaU: number;
  /** ΔU relativo a U antes (0,25 = +25%). */
  relative: number;
  alternative: { name: string; deltaU: number } | null;
  parts: GainPart[];
  family: Family | null;
  mechanism: string;
  /** Ordem de execução, com tempos. */
  play: string[];
  /** Cenário em que a jogada mais rende. */
  scenario: string;
  condition: string;
  metric: string;
  sources: string[];
  uncertainty: string[];
  /** Confiança de que a interação funciona como modelada. */
  confidenceWorks: Confidence;
  /** Confiança de que esta é a melhor compra agora. */
  confidenceBest: Confidence;
  kind: "mecânica" | "mecânica + partidas";
  observed: Observed | null;
  text: string;
}

export interface PurchaseContext {
  hero: string;
  souls: number;
  abilityTiers: number[];
  itemSlots?: number;
  uptime?: number;
  plan: PlanId;
  scenario?: Partial<Scenario>;
  /** Tipos de luta esperados; sem isso vale a mistura do plano (cenário assumido). */
  fights?: ScenarioId[];
  /**
   * Vantagem relativa da compra sobre a alternativa na pontuação do otimizador
   * (ganho por soul). Sem isso, a margem vem só das jogadas simuladas.
   */
  scoreMargin?: number;
}

const SETUP: EffectDef["state"][] = ["pull", "immobilize", "stun", "sleep", "slow", "movementSilence", "resistShred", "silence"];
// Rótulos em [português, inglês]; o idioma é escolhido no uso (depois de definido).
const SETUP_LABEL: Partial<Record<EffectDef["state"], [string, string]>> = {
  pull: ["puxão (reposicionar os alvos)", "pull (reposition the targets)"],
  immobilize: ["imobilização", "immobilize"],
  stun: ["stun", "stun"],
  sleep: ["sono", "sleep"],
  slow: ["lentidão", "slow"],
  movementSilence: ["silêncio de movimento (sem dash)", "movement silence (no dash)"],
  resistShred: ["redução de resistência", "resistance reduction"],
  silence: ["silêncio", "silence"],
};
const setupLabel = (state: EffectDef["state"]): string => {
  const l = SETUP_LABEL[state];
  return l ? tr(l[0], l[1]) : state;
};

/** Ganho de U abaixo disso é ruído da simulação. */
const MIN_GAIN = 0.5;

const evaluate = (data: GameData, ctx: PurchaseContext, items: string[]) =>
  evaluateBuild(data, { hero: ctx.hero, souls: ctx.souls, items, abilityTiers: ctx.abilityTiers, itemSlots: ctx.itemSlots, uptime: ctx.uptime ?? 0.5 });

const fmtT = (t: number) => tr(`${t.toFixed(2).replace(".", ",")} s`, `${t.toFixed(2)} s`);

function describePlay(best: SequenceResult | null): string[] {
  if (!best) return [];
  return best.steps.map((s, i) => (i === 0 ? s.name : tr(`${s.name} ${fmtT(s.at - best.steps[i - 1]!.at)} depois`, `${s.name} ${fmtT(s.at - best.steps[i - 1]!.at)} later`)));
}

const pp = (x: number) => `${x >= 0 ? "+" : "−"}${tr(Math.abs(x).toFixed(1).replace(".", ","), Math.abs(x).toFixed(1))} pp`;

/**
 * O que as partidas dizem da compra. Prefere a janela de compra (mesmo momento da
 * partida, contra o que o herói compra nessa janela); sem ela, cai para a média do
 * herói e avisa do viés. `modelPrefersItem` = o motor pôs o item à frente da alternativa.
 */
function observedFor(data: GameData, heroId: number, item: Item, minute: number, alternative: Item | null, modelPrefersItem: boolean): Observed | null {
  const meta = heroMeta(data, heroId);
  const usage = meta?.items[item.className];
  const win = windowStat(data, heroId, item, minute);
  if (!win && (!meta || !usage || usage.matches === 0)) return null;
  const wpa = itemWpa(data, heroId, item);
  const notes: string[] = [];
  if (wpa)
    notes.push(
      tr(
        `vitória acima do esperado pela vantagem de patrimônio na hora da compra: ${pp(wpa.relative)} ± ${wpa.margin.toFixed(1)} contra os outros itens do tier ${item.tier} do herói (${wpa.purchases} compras)`,
        `wins above expectation given the net worth lead at purchase time: ${pp(wpa.relative)} ± ${wpa.margin.toFixed(1)} vs the hero's other tier ${item.tier} items (${wpa.purchases} purchases)`,
      ),
    );
  let versus: Observed["versusAlternative"] = null;
  let diverges = false;
  if (win) {
    notes.push(
      tr(
        `comprado aos ${win.window}: winrate ${win.winrate.toFixed(1)}% contra ${win.baseline.toFixed(1)}% das compras do herói na mesma janela (${pp(win.delta)} ± ${win.margin.toFixed(1)}, ${win.matches} partidas)`,
        `bought at ${win.window}: winrate ${win.winrate.toFixed(1)}% vs ${win.baseline.toFixed(1)}% for the hero's purchases in the same window (${pp(win.delta)} ± ${win.margin.toFixed(1)}, ${win.matches} matches)`,
      ),
    );
    // Itens de preço diferente na mesma janela não se comparam: quem compra o mais caro
    // cedo já tem mais souls (está à frente), e o winrate dele mede isso, não o item.
    if (alternative && alternative.tier !== item.tier) {
      notes.push(
        tr(
          `${alternative.name} é de outro tier: na mesma janela, quem compra o item mais caro já está à frente; a comparação de winrate não decide`,
          `${alternative.name} is a different tier: in the same window, whoever buys the pricier item is already ahead; the winrate comparison doesn't settle it`,
        ),
      );
    } else if (alternative) {
      const cmp = compareInWindow(data, heroId, item, alternative, minute);
      if (cmp) {
        versus = { name: alternative.name, diff: cmp.diff, margin: cmp.margin, significant: cmp.significant };
        diverges = cmp.significant && (cmp.diff > 0) !== modelPrefersItem;
        if (diverges)
          notes.push(
            tr(
              `modelo e partidas divergem: na mesma janela, ${cmp.diff > 0 ? item.name : alternative.name} vence ${Math.abs(cmp.diff).toFixed(1)} pp mais (± ${cmp.margin.toFixed(1)})`,
              `model and matches disagree: in the same window, ${cmp.diff > 0 ? item.name : alternative.name} wins ${Math.abs(cmp.diff).toFixed(1)} pp more (± ${cmp.margin.toFixed(1)})`,
            ),
          );
      } else notes.push(tr(`${alternative.name}: amostra pequena na mesma janela para comparar`, `${alternative.name}: sample too small in the same window to compare`));
    }
    if (!wpa)
      notes.push(
        tr(
          "o momento da compra é o único estado anterior à decisão nos dados; inventário e vantagem de souls na hora não estão (o filtro de patrimônio da API usa o patrimônio final)",
          "purchase timing is the only pre-decision state in the data; inventory and soul lead at that moment are not (the API's net worth filter uses final net worth)",
        ),
      );
  } else {
    if (usage!.matches < 1000) notes.push(tr(`amostra pequena (${usage!.matches} partidas)`, `small sample (${usage!.matches} matches)`));
    if (usage!.buyMinute >= 25)
      notes.push(
        tr(
          `comprado em média no minuto ${Math.round(usage!.buyMinute)}: quem já está ganhando chega antes ao item, então o winrate superestima o efeito`,
          `bought on average at minute ${Math.round(usage!.buyMinute)}: players who are already winning get the item sooner, so the winrate overstates its effect`,
        ),
      );
    notes.push(tr("sem dados por janela de compra: comparado com a média do herói, sem controlar o momento da partida", "no per-window purchase data: compared with the hero's average, without controlling for game time"));
  }
  return {
    matches: win?.matches ?? usage!.matches,
    winrateDelta: win ? win.delta : (usage!.wins / usage!.matches - meta!.wins / meta!.matches) * 100,
    buyMinute: usage?.buyMinute ?? minute,
    window: win,
    versusAlternative: versus,
    diverges,
    wpa,
    notes,
  };
}

function mainScenario(before: PlayReport, after: PlayReport) {
  let best = after.scenarios[0]!;
  let gain = -Infinity;
  for (const s of after.scenarios) {
    const b = before.scenarios.find((x) => x.id === s.id)?.perMinute ?? 0;
    if (s.weight * (s.perMinute - b) > gain) [gain, best] = [s.weight * (s.perMinute - b), s];
  }
  return best;
}

/** Analisa a compra de `item` (ou a troca) a partir do inventário `before`. */
export function analyzePurchase(data: GameData, ctx: PurchaseContext, before: string[], after: string[], item: Item, alternative?: { item: Item; after: string[] } | null): Recommendation {
  const hero = data.heroes.find((h) => h.name === ctx.hero || h.className === ctx.hero)!;
  const bBuild = evaluate(data, ctx, before);
  const aBuild = evaluate(data, ctx, after);
  const opts = { ...(ctx.scenario ? { scenario: ctx.scenario } : {}), ...(ctx.fights?.length ? { only: ctx.fights } : {}) };
  const uBefore = playReport(bBuild, ctx.plan, opts);
  const uAfter = playReport(aBuild, ctx.plan, opts);
  const deltaU = uAfter.utility - uBefore.utility;

  // Atribuição: repete a simulação sem um efeito de preparo do item, com o resto igual.
  const own = buildEffects(aBuild, data.meta.clientVersion).filter((e) => e.source.className === item.className);
  const parts: GainPart[] = [];
  const effectsAfter = buildEffects(aBuild, data.meta.clientVersion);
  const ehpBefore = effectiveHealth(bBuild);
  const ehpAfter = effectiveHealth(aBuild);
  const candidates = discoverInteractions(effectsAfter, { defenseGain: ehpAfter > ehpBefore * 1.02 });
  const mainPre = mainScenario(uBefore, uAfter);
  const usedPre = new Set(mainPre.best?.steps.map((s) => s.source) ?? []);
  for (const e of own.filter((x) => SETUP.includes(x.state))) {
    const without = playReport(aBuild, ctx.plan, { ...opts, disable: (x) => x.id === e.id });
    const value = uAfter.utility - without.utility;
    if (Math.abs(value) < 1e-6) continue;
    parts.push({ label: setupLabel(e.state), family: familyFor(candidates, item.className, usedPre, e.id), value });
  }
  if (ehpAfter > ehpBefore * 1.02) {
    const sameEhp = playReport(aBuild, ctx.plan, { ...opts, ehp: ehpBefore });
    const value = uAfter.utility - sameEhp.utility;
    if (value > 1e-6) parts.push({ label: tr("sobreviver à iniciação e concluir a jogada", "survive the initiation and finish the play"), family: "defenseExposure", value });
  }
  parts.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const top = parts[0] ?? null;
  // Sem ganho medido nas jogadas, nenhum mecanismo é atribuído à compra.
  const gained = deltaU > MIN_GAIN;
  const family = !gained ? null : (top && top.value > 0 ? top.family : null) ?? familyFor(candidates, item.className, usedPre);

  // Alternativa de mesmo orçamento.
  let alt: Recommendation["alternative"] = null;
  if (alternative) {
    const altU = playReport(evaluate(data, ctx, alternative.after), ctx.plan, opts).utility;
    // (U só mede as jogadas; a alternativa pode ganhar em dano ou defesa fora delas.)
    alt = { name: alternative.item.name, deltaU: altU - uBefore.utility };
  }

  const main = mainScenario(uBefore, uAfter);
  const beforeMain = uBefore.scenarios.find((s) => s.id === main.id);
  const play = describePlay(main.best);

  // Condições: onde o ganho aparece e onde some (dispersos, aliado já prendendo o alvo).
  const gainIn = (id: ScenarioId) => (uAfter.scenarios.find((s) => s.id === id)?.perMinute ?? 0) - (uBefore.scenarios.find((s) => s.id === id)?.perMinute ?? 0);
  const holdOpts = { only: ["duel"] as ScenarioId[], scenario: { ...ctx.scenario, allyHold: { target: 0, until: 3.5, state: "stun" as const } } };
  const holdGain = playReport(aBuild, ctx.plan, holdOpts).utility - playReport(bBuild, ctx.plan, holdOpts).utility;
  const duelGain = gainIn("duel");
  const conditions: string[] = [];
  const good = uAfter.scenarios.filter((s) => gainIn(s.id) > 0.05 * Math.max(1, s.perMinute)).map((s) => s.label);
  const weak = uAfter.scenarios.filter((s) => gainIn(s.id) <= 0.05 * Math.max(1, s.perMinute)).map((s) => s.label);
  const several = uAfter.scenarios.length > 1;
  if (gained && several && good.length) conditions.push(tr(`rende em ${good.join(", ")}`, `pays off in ${good.join(", ")}`));
  if (gained && several && weak.length) conditions.push(tr(`quase nada em ${weak.join(", ")}`, `almost nothing in ${weak.join(", ")}`));
  if (gained && duelGain > 0 && holdGain < duelGain * 0.6)
    conditions.push(
      tr(
        `se um aliado já prende o único alvo até a detonação, o ganho no duelo cai ${Math.round((1 - holdGain / duelGain) * 100)}%`,
        `if an ally already holds the only target until the detonation, the duel gain drops ${Math.round((1 - holdGain / duelGain) * 100)}%`,
      ),
    );

  // Métrica afetada no cenário principal.
  const mb = beforeMain?.best?.sim;
  const ma = main.best?.sim;
  const metricBits: string[] = [];
  if (ma && mb) {
    const hits = (s: typeof ma) => Object.values(s.hits).reduce((x, y) => x + y, 0);
    if (hits(ma) !== hits(mb)) metricBits.push(tr(`alvos atingidos ${hits(mb)} → ${hits(ma)}`, `targets hit ${hits(mb)} → ${hits(ma)}`));
    if (Math.abs(ma.control - mb.control) > 0.05) metricBits.push(tr(`controle útil ${mb.control.toFixed(1)} → ${ma.control.toFixed(1)} s`, `useful control ${mb.control.toFixed(1)} → ${ma.control.toFixed(1)} s`));
    if (Math.abs(ma.damage - mb.damage) > 5) metricBits.push(tr(`dano na janela ${Math.round(mb.damage)} → ${Math.round(ma.damage)}`, `damage in the window ${Math.round(mb.damage)} → ${Math.round(ma.damage)}`));
    if (ma.casterAlive !== mb.casterAlive) metricBits.push(ma.casterAlive ? tr("conclui a sequência vivo", "finishes the sequence alive") : tr("morre antes de concluir", "dies before finishing"));
    const esc = (s: typeof ma) => Object.values(s.escaped).reduce((x, y) => x + y, 0);
    if (esc(ma) !== esc(mb)) metricBits.push(tr(`escapam da detonação ${esc(mb)} → ${esc(ma)}`, `escape the detonation ${esc(mb)} → ${esc(ma)}`));
  } else if (ma && !mb) metricBits.push(tr("primeira jogada disponível", "first play available"));
  metricBits.push(tr(`valor por minuto ${(beforeMain?.perMinute ?? 0).toFixed(1)} → ${main.perMinute.toFixed(1)} (${main.label})`, `value per minute ${(beforeMain?.perMinute ?? 0).toFixed(1)} → ${main.perMinute.toFixed(1)} (${main.label})`));

  // Fontes e incertezas dos efeitos usados na jogada.
  const used = new Set(main.best?.steps.map((s) => s.source) ?? []);
  const usedEffects = effectsAfter.filter((e) => used.has(e.source.className) || e.source.className === item.className);
  const sources = [...new Set(usedEffects.map((e) => (e.provenance.url ? `${e.source.name}: ${e.provenance.url}` : tr(`${e.source.name}: propriedades do patch ${data.meta.clientVersion} (deadlock-api.com)`, `${e.source.name}: patch ${data.meta.clientVersion} properties (deadlock-api.com)`))))];
  const stale = staleSources(data);
  const unknown = [...new Set(usedEffects.flatMap((e) => e.provenance.unknown.map((u) => `${e.source.name}: ${u}`)))];
  const staleUsed = [...used].filter((s) => stale.has(s));
  const uncertainty = [
    ...unknown,
    ...staleUsed.map((s) => tr(`${s}: definição revisada em outro patch e com valores mudados (revisar)`, `${s}: definition reviewed in another patch and values have changed (needs review)`)),
    ctx.fights?.length
      ? tr(`lutas escolhidas: ${ctx.fights.map((f) => SCENARIO_LABEL[f]).join(", ")}`, `chosen fights: ${ctx.fights.map((f) => SCENARIO_LABEL[f]).join(", ")}`)
      : tr(
          `cenário assumido (sem informação do adversário): mistura de ${Object.entries(PLANS[ctx.plan].scenarios).map(([k, w]) => `${SCENARIO_LABEL[k as ScenarioId]} ${Math.round(w * 100)}%`).join(", ")}`,
          `assumed scenario (no information on the opponent): mix of ${Object.entries(PLANS[ctx.plan].scenarios).map(([k, w]) => `${SCENARIO_LABEL[k as ScenarioId]} ${Math.round(w * 100)}%`).join(", ")}`,
        ),
    tr("posições, reação do inimigo, dano da iniciação e dos aliados ainda sem calibração com replays", "positions, enemy reaction, initiation damage and ally damage not yet calibrated against replays"),
  ];
  // Margem do modelo: a do otimizador (pontuação inteira, por soul) quando vem de lá; senão, a das jogadas.
  const margin = ctx.scoreMargin ?? (alt ? (deltaU - alt.deltaU) / Math.max(Math.abs(deltaU), 1e-6) : 1);
  const minute = minuteForSouls(data, hero.id, ctx.souls);
  const observed = observedFor(data, hero.id, item, minute, alternative?.item ?? null, margin >= 0);
  if (observed) uncertainty.push(...observed.notes.map((n) => `${item.name}: ${n}`));

  const confidenceWorks: Confidence = staleUsed.length ? "baixa" : unknown.length > 2 ? "média" : "alta";
  const LEVELS: Confidence[] = ["baixa", "média", "alta"];
  const shift = (c: Confidence, by: number) => LEVELS[Math.max(0, Math.min(2, LEVELS.indexOf(c) + by))]!;
  let confidenceBest: Confidence = margin > 0.25 ? "alta" : margin > 0.05 ? "média" : "baixa";
  if (observed?.window) {
    // Partidas na mesma janela de compra: confirmam, contrariam ou não decidem.
    const vs = observed.versusAlternative;
    if (observed.diverges) confidenceBest = "baixa";
    else if (vs?.significant) confidenceBest = shift(confidenceBest, 1);
    // Abaixo do esperado na janela ou pelo estado da partida: um nível a menos (uma vez só).
    const wpa = observed.wpa;
    if (observed.window.delta + observed.window.margin < 0 || (wpa && wpa.relative + wpa.margin < 0)) confidenceBest = shift(confidenceBest, -1);
  } else {
    if (observed && observed.winrateDelta < -3) confidenceBest = shift(confidenceBest, -1);
    // Sem partidas no mesmo momento, a recomendação não passa de "média".
    if (confidenceBest === "alta") confidenceBest = "média";
  }

  const mechanism = family
    ? FAMILY_LABEL[family]
    : deltaU > 0
      ? tr("atributos (vida, dano, alcance) sem interação própria", "stats (health, damage, range) with no interaction of their own")
      : tr("sem ganho nas jogadas simuladas", "no gain in the simulated plays");
  const relative = uBefore.utility > 0 ? deltaU / uBefore.utility : deltaU > 0 ? 1 : 0;
  const pairs = candidates.filter((c) => c.family === family && (c.setup?.source.className === item.className || c.payoff.source.className === item.className));
  // Entre os pares da jogada, o que tem detonação atrasada é o que o preparo resolve.
  const inPlay = pairs.filter((c) => used.has(c.payoff.source.className) && used.has(c.setup?.source.className ?? ""));
  const pair = inPlay.find((c) => c.payoff.timing.resolveDelay > 0) ?? inPlay[0] ?? pairs[0];
  const text = gained ? writeText({ item, family, play, main: main.label, holdGain, duelGain, alt, deltaU, parts, payoff: pair?.payoff.source.name ?? null, setup: pair?.setup?.source.name ?? null, payoffDelayed: (pair?.payoff.timing.resolveDelay ?? 0) > 0 }) : alt && alt.deltaU > MIN_GAIN ? tr(`Sem ganho nas jogadas; ${alt.name} somaria ${alt.deltaU.toFixed(1)}. A compra vem de dano ou defesa fora das jogadas.`, `No gain in the plays; ${alt.name} would add ${alt.deltaU.toFixed(1)}. The purchase comes from damage or defense outside the plays.`) : "";

  return {
    purchase: item.name,
    plan: ctx.plan,
    deltaU,
    relative,
    alternative: alt,
    parts,
    family,
    mechanism,
    play,
    scenario: main.label,
    condition: conditions.join("; "),
    metric: metricBits.join("; "),
    sources,
    uncertainty,
    confidenceWorks,
    confidenceBest,
    kind: observed ? "mecânica + partidas" : "mecânica",
    observed,
    text,
  };
}

function writeText(a: { item: Item; family: Family | null; play: string[]; main: string; holdGain: number; duelGain: number; alt: Recommendation["alternative"]; deltaU: number; parts: GainPart[]; payoff: string | null; setup: string | null; payoffDelayed: boolean }): string {
  const bits: string[] = [];
  const order = a.play.join(" → ");
  const setup = a.setup ?? a.item.name;
  if ((a.family === "grouping" || a.family === "restraintDelayed") && a.payoff) {
    const verb = a.payoffDelayed ? tr("detonar", "detonates") : tr("acertar", "hits");
    bits.push(
      tr(
        `Use ${setup} para ${a.family === "grouping" ? "puxar os inimigos para a área" : "prender os alvos"} antes de ${a.payoff} ${verb}.`,
        `Use ${setup} to ${a.family === "grouping" ? "pull the enemies into the area" : "hold the targets"} before ${a.payoff} ${verb}.`,
      ),
    );
  } else if (a.family === "zoneDot" && a.payoff) {
    bits.push(tr(`Use ${setup} para manter os alvos dentro de ${a.payoff}.`, `Use ${setup} to keep the targets inside ${a.payoff}.`));
  } else if (a.family === "defenseExposure") {
    bits.push(tr(`A vida a mais deixa você sobreviver à iniciação e concluir a jogada.`, `The extra health lets you survive the initiation and finish the play.`));
  }
  if (a.play.length) bits.push(tr(`Ordem em ${a.main}: ${order}.`, `Order in ${a.main}: ${order}.`));
  if (a.duelGain > 0 && a.holdGain < a.duelGain * 0.6)
    bits.push(tr(`Se seu aliado já prende o único alvo até a detonação, o preparo rende pouco: essas souls podem ir para proteção.`, `If your ally already holds the only target until the detonation, the setup adds little: those souls can go to protection.`));
  if (a.alt && a.alt.deltaU > a.deltaU) bits.push(tr(`${a.alt.name} rende mais agora com o mesmo orçamento.`, `${a.alt.name} pays off more right now on the same budget.`));
  return bits.join(" ");
}

export interface Situational {
  scenario: ScenarioId;
  label: string;
  item: Item;
  /** Ganho nas jogadas daquele tipo de luta (por minuto). */
  gain: number;
  /** Ganho do item da build que ele substituiria. */
  replaces: { item: Item; loss: number } | null;
  mechanism: string;
}

/**
 * Alternativas situacionais para a build pronta: por tipo de luta, o item com
 * efeito de combate que mais soma às jogadas trocando o item da build que menos
 * rende nelas. Candidatos pelas mecânicas (ativos com efeito no inimigo).
 */
export function situationalOptions(data: GameData, ctx: PurchaseContext, items: string[], candidates: Item[]): Situational[] {
  const build = evaluate(data, ctx, items);
  const now = playReport(build, ctx.plan);
  const perScenario = (r: PlayReport, id: ScenarioId) => r.scenarios.find((s) => s.id === id)?.perMinute ?? 0;
  const owned = build.items;
  const out: Situational[] = [];
  // Item da build que menos rende nas jogadas (sai para dar lugar).
  const losses = owned
    .filter((i) => !i.isActive || owned.filter((x) => x.isActive).length >= 4)
    .map((i) => ({ item: i, report: playReport(evaluate(data, ctx, owned.filter((x) => x !== i).map((x) => x.className)), ctx.plan) }));
  for (const id of Object.keys(PLANS[ctx.plan].scenarios) as ScenarioId[]) {
    let best: Situational | null = null;
    for (const cand of candidates) {
      if (owned.some((o) => o.className === cand.className)) continue;
      const full = owned.length >= (ctx.itemSlots ?? 9);
      const victim = full ? losses.sort((a, b) => perScenario(now, id) - perScenario(a.report, id) - (perScenario(now, id) - perScenario(b.report, id)))[0] : null;
      const list = [...owned.filter((o) => o !== victim?.item).map((x) => x.className), cand.className];
      const after = playReport(evaluate(data, ctx, list), ctx.plan);
      const gain = perScenario(after, id) - perScenario(now, id);
      if (gain > 0 && (!best || gain > best.gain)) {
        const used = new Set(after.scenarios.find((s) => s.id === id)?.best?.steps.map((s) => s.source) ?? []);
        const fam = familyFor(discoverInteractions(buildEffects(evaluate(data, ctx, list), data.meta.clientVersion)), cand.className, used);
        best = { scenario: id, label: SCENARIO_LABEL[id], item: cand, gain, replaces: victim ? { item: victim.item, loss: perScenario(now, id) - perScenario(victim.report, id) } : null, mechanism: fam ? FAMILY_LABEL[fam] : tr("atributos", "stats") };
      }
    }
    if (best) out.push(best);
  }
  return out;
}

/** Recalcula U de uma build fixa num plano (útil para a interface e o CLI). */
export function buildPlay(data: GameData, ctx: PurchaseContext, items: string[]): { build: BuildResult; report: PlayReport } {
  const build = evaluate(data, ctx, items);
  return { build, report: playReport(build, ctx.plan, { ...(ctx.scenario ? { scenario: ctx.scenario } : {}), ...(ctx.fights?.length ? { only: ctx.fights } : {}) }) };
}

export { PLANS };
