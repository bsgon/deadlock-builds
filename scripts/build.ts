/**
 * Gera uma build otimizada.
 *
 *   npm run build-for -- "<herói>" <objetivo> <souls> [opções]
 *
 * Objetivos: optimized, dps, weapon, spirit, tank, sustain, bruiser, control
 * Opções:
 *   --slots 9..12         slots de item liberados (padrão 9)
 *   --uptime 0..1         tempo ativo de efeitos condicionais (padrão 0.5)
 *   --with "A,B"          itens obrigatórios
 *   --without "A,B"       itens proibidos
 *   --meta                consulta o winrate real dos itens na API (precisa de internet)
 *   --vit-by 15           minuto até o qual a build precisa ter 4.800 souls em vitality
 *   --no-vit              desliga a regra do pico de vitality
 *   --fight "a,b"         tipos de luta esperados: duel, skirmish, teamfight, spread, chase, dive
 *                         (padrão: mistura, mostrada como cenário assumido)
 *   --no-explain          não explica cada compra (mais rápido)
 *   --situational         lista alternativas situacionais também fora do objetivo control
 *   --final               escolhe a melhor build para os souls finais e só depois ordena
 *                         (o padrão monta a build compra a compra, como na partida)
 *
 * Com data/snapshot/stats.json (npm run stats), mostra também quando o herói
 * costuma ter esses souls e compara com as builds publicadas mais jogadas.
 */
import { loadSnapshot } from "../src/data/load.ts";
import { BASE_ITEM_SLOTS, findHero, MAX_ACTIVE_ITEMS } from "../src/engine/index.ts";
import { controlBreakdown, DEFAULT_METRIC_OPTIONS, OBJECTIVES, type Objective } from "../src/optimizer/metrics.ts";
import { CONTROL_LABEL, CONTROL_MIN_PER_MINUTE, heroControl } from "../src/optimizer/control.ts";
import { defenseOf } from "../src/optimizer/defense.ts";
import { compareWithPopular, itemPickRates } from "../src/meta/compare.ts";
import { buyMinute, heroMeta, meleePickRate, midGameSouls, minuteForSouls, powerWindows, tierGates } from "../src/meta/stats.ts";
import { VITALITY_SPIKE_SOULS } from "../src/engine/rules.ts";
import { optimize, type OptimizeInput } from "../src/optimizer/optimize.ts";
import { phaseOf, validateRoute } from "../src/optimizer/route.ts";
import { buildPlay, situationalOptions } from "../src/combat/explain.ts";
import { reviewStatus } from "../src/combat/mechanics.ts";
import { PLANS, type ScenarioId } from "../src/combat/value.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const list = (name: string) => (option(name) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const [heroName, objective, soulsArg] = args;

if (!heroName || !objective || !soulsArg || !(objective in OBJECTIVES)) {
  console.log(`Uso: build-for "<herói>" <${Object.keys(OBJECTIVES).join("|")}> <souls> [--slots N] [--uptime X] [--with "A,B"] [--without "A,B"] [--meta]`);
  process.exit(1);
}

const data = loadSnapshot();
const f = (n: number, d = 0) => n.toFixed(d);
const pct = (now: number, base: number) => (base > 0 ? `${now >= base ? "+" : ""}${f((now / base - 1) * 100)}%` : "n/d");

const heroForSpike = findHero(data, heroName);
const input: OptimizeInput = {
  hero: heroName,
  objective: objective as Objective,
  souls: Number(soulsArg),
  itemSlots: option("slots") ? Number(option("slots")) : undefined,
  maxTier: 4,
  required: list("with"),
  banned: list("without"),
  metric: option("uptime") ? { uptime: Number(option("uptime")) } : undefined,
  mode: flag("final") ? "final" : "progressive",
  explain: !flag("no-explain"),
  ...(list("fight").length ? { fights: list("fight") as ScenarioId[] } : {}),
  vitalitySpike: flag("no-vit")
    ? false
    : option("vit-by")
      ? { souls: VITALITY_SPIKE_SOULS, deadline: midGameSouls(data, heroForSpike.id, Number(option("vit-by"))) }
      : undefined,
};
const result = optimize(data, input);

const m = result.metrics;
const b = result.baseline;
console.log(`=== ${result.hero} | objetivo ${objective} | ${result.souls} souls (patch ${data.meta.clientVersion}) ===`);
console.log(`Gasto: ${result.spent} souls em ${result.items.length} itens | pontuação ${f(result.score, 2)}x a build sem itens`);
console.log(`\nMétrica          sem itens   com a build`);
const row = (label: string, base: number, now: number, d = 0) => console.log(`${label.padEnd(16)} ${f(base, d).padStart(9)}   ${f(now, d).padStart(9)}  (${pct(now, base)})`);
row("DPS de arma", b.weaponDps, m.weaponDps);
row("DPS habilidades", b.abilityDps, m.abilityDps);
row("DPS de itens", b.itemDps, m.itemDps);
row("DPS corpo a corpo", b.meleeDps, m.meleeDps);
if (m.antiHealDps > 0) row("Cura negada", b.antiHealDps, m.antiHealDps);
row("DPS total", b.totalDps, m.totalDps);
row("  de quem atira", b.gunDps, m.gunDps);
row("  de spirit", b.spiritDps, m.spiritDps);
row("Vida efetiva", b.ehp, m.ehp);
{
  const d = defenseOf(result.build);
  if (d.sources.length)
    console.log(
      `  defesa além de vida e resistência: barreiras ${f(d.barrier)} por luta, tempo protegido +${f(d.time * 100)}%, controle ${f(d.cc * 100)}%, desvio ${f(d.deflect * 100)}% (${[...new Set(d.sources.map((s) => s.name))].join(", ")})`,
    );
}
row("Cura por segundo", b.sustain, m.sustain, 1);
row("Controle (s/min)", b.control, m.control, 1);
if (m.play > 0) row("Jogadas (U/min)", b.play, m.play, 1);
const meleeRate = meleePickRate(data, heroForSpike.id);
console.log(
  `Efeitos de corpo a corpo valem ${f(result.build.meleeShare * 100)}% para ${result.hero}` +
    (meleeRate === null ? " (sem estatísticas; padrão)" : ` (itens de melee comprados em ${f(meleeRate * 100)}% das partidas)`),
);
if (objective === "control") {
  const kit = heroControl(data, result.hero);
  if (kit < CONTROL_MIN_PER_MINUTE) console.log(`Aviso: ${result.hero} tem pouco controle no kit (${f(kit, 1)} s/min); o app usa a "Otimizada" para ele.`);
  console.log(`Fontes de controle: ${controlBreakdown(result.build, { ...DEFAULT_METRIC_OPTIONS, ...input.metric }).map((s) => `${s.name} ${f(s.perMinute, 1)} (${s.kinds.map((k) => CONTROL_LABEL[k]).join(", ")})`).join("; ") || "nenhuma"}`);
}
if (result.weights.ehpFloor) {
  const floor = result.weights.ehpFloor * b.ehp;
  console.log(`Defesa mínima (vida efetiva das builds mais jogadas com esses souls, -10%): ${f(floor)}${m.ehp >= floor * 0.99 ? "" : " (não alcançada)"}`);
}

if (!flag("final")) {
  const gates = tierGates(data, heroForSpike.id);
  console.log(`\nTiers liberados (souls ganhos em que o herói costuma comprar): T2 ${gates[2]}, T3 ${gates[3]}, T4 ${gates[4]}`);
}
console.log(`\nOrdem de compra (souls ganhos e minuto aproximado; no fim, quando os jogadores compram o item):`);
let lastPhase = "";
for (const [i, step] of result.order.entries()) {
  const phase = phaseOf(step.minute);
  if (phase !== lastPhase) console.log(`  — ${phase} —`);
  lastPhase = phase;
  const notes = [
    step.upgradeFrom ? `melhora ${step.upgradeFrom.name}` : "",
    step.sold ? `vende ${step.sold.name}` : "",
    step.isComponent ? "vira componente" : "",
    step.soldLater ? "vendido depois" : "",
    step.community ? `troca da comunidade: ${step.community.title}, ${step.community.builds} builds` : "",
  ].filter(Boolean);
  const real = buyMinute(data, heroForSpike.id, step.item);
  console.log(
    `${String(i + 1).padStart(2)}. ${String(Math.round(step.earned)).padStart(6)} souls ~${f(step.minute).padStart(2)} min  ${step.item.name} [${step.item.slot} T${step.item.tier}, paga ${step.cost}]${notes.length ? ` (${notes.join("; ")})` : ""}  → ${f(step.score, 2)}x${real === null ? "" : `  (jogadores: ~${f(real)} min)`}`,
  );
  const w = step.why;
  if (step.opensCombo) console.log(`      abre combo com ${step.opensCombo.join(", ")} (busca em pares)`);
  if (step.tieBreak)
    console.log(`      desempate pelas partidas: passou à frente de ${step.tieBreak.over.name} (ganho por soul quase igual), vence ${f(step.tieBreak.diff, 1)} pp mais quando comprado aos ${step.tieBreak.window} (± ${f(step.tieBreak.margin, 1)})`);
  const mp = step.matchPrior;
  if (mp && Math.abs(mp.factor - 1) >= 0.05)
    console.log(`      peso das partidas: ×${f(mp.factor, 2)} (aos ${mp.window}, ${mp.delta >= 0 ? "+" : ""}${f(mp.delta, 1)} pp contra o mesmo tier ± ${f(mp.margin, 1)}; ${mp.matches} partidas)`);
  if (w && (Math.abs(w.deltaU) > 0.5 || step.alternative)) {
    console.log(`      ΔU jogadas ${w.deltaU >= 0 ? "+" : ""}${f(w.deltaU, 1)} (${pct(1 + w.relative, 1)})${w.alternative ? ` | alternativa: ${w.alternative.name} ${w.alternative.deltaU >= 0 ? "+" : ""}${f(w.alternative.deltaU, 1)}` : ""} | mecanismo: ${w.mechanism}`);
    if (w.parts.length) console.log(`      de onde vem: ${w.parts.map((p) => `${p.label} ${p.value >= 0 ? "+" : ""}${f(p.value, 1)}`).join("; ")}`);
    if (w.text) console.log(`      jogada: ${w.text}`);
    if (w.metric) console.log(`      métrica: ${w.metric}`);
    if (w.condition) console.log(`      condição: ${w.condition}`);
    const o = w.observed;
    const seen = !o
      ? ""
      : o.window
        ? `, ${o.window.matches} partidas compradas aos ${o.window.window}: ${o.winrateDelta >= 0 ? "+" : ""}${f(o.winrateDelta, 1)} ± ${f(o.window.margin, 1)} pp vs compras da mesma janela${o.versusAlternative ? `; vs ${o.versusAlternative.name} ${o.versusAlternative.diff >= 0 ? "+" : ""}${f(o.versusAlternative.diff, 1)} ± ${f(o.versusAlternative.margin, 1)} pp` : ""}${o.diverges ? "; MODELO E PARTIDAS DIVERGEM" : ""}`
        : `, ${o.matches} partidas, winrate ${o.winrateDelta >= 0 ? "+" : ""}${f(o.winrateDelta, 1)} pp vs média do herói (sem janela de compra)`;
    console.log(`      confiança: interação ${w.confidenceWorks}, melhor compra agora ${w.confidenceBest} (${w.kind}${seen})`);
  }
}
const slotCount = input.itemSlots ?? BASE_ITEM_SLOTS;
const order = { weapon: 0, vitality: 1, spirit: 2 } as const;
const finalItems = [...result.items].sort((a, c) => order[a.slot] - order[c.slot] || c.tier - a.tier);
console.log(
  `\nBuild final (depois de vendas e upgrades): ${finalItems.length} de ${slotCount} slots, ${finalItems.filter((i) => i.isActive).length} de ${MAX_ACTIVE_ITEMS} ativos`,
);
for (const item of finalItems) console.log(`  [${item.slot} T${item.tier}] ${item.name}${item.isActive ? " (ativo)" : ""}`);
for (let i = finalItems.length; i < slotCount; i++) console.log("  [slot livre]");
console.log(`\nUpgrades de habilidade (T por slot): ${result.abilityTiers.join(" / ")}`);
console.log(`Avaliações de build na busca: ${result.evaluations}`);

// Jogadas da build final: melhor sequência por tipo de luta (simulação por eventos).
{
  const plan = input.plan ?? (result.weights.play ? "control" : "damage");
  const ctx = { hero: result.hero, souls: result.souls, abilityTiers: result.abilityTiers, itemSlots: input.itemSlots, uptime: input.metric?.uptime, plan, ...(input.fights ? { fights: input.fights } : {}) } as const;
  const { report } = buildPlay(data, ctx, result.items.map((i) => i.className));
  console.log(`\nJogadas da build (plano ${PLANS[plan].label}; ${input.fights ? `lutas: ${input.fights.join(", ")}` : data.fights ? `mistura medida em ${data.fights.matches} partidas, luta de ${data.fights.timeToKill.median} s` : "cenário assumido: mistura de tipos de luta"}):`);
  for (const s of report.scenarios) {
    const seq = s.best?.steps.map((x, i) => (i === 0 ? x.name : `${x.name} +${f(x.at - s.best!.steps[i - 1]!.at, 2)}s`)).join(" → ") ?? "nenhuma";
    const sim = s.best?.sim;
    const hits = sim ? Object.values(sim.hits).reduce((a, c) => a + c, 0) : 0;
    const esc = sim ? Object.values(sim.escaped).reduce((a, c) => a + c, 0) : 0;
    console.log(`  ${s.label.padEnd(26)} ${seq}${sim ? `  | atingidos ${hits}, escaparam ${esc}, controle útil ${f(sim.control, 1)} s, dano ${f(sim.damage)}${sim.casterAlive ? "" : ", herói morre antes de concluir"}` : ""}`);
  }
  if (flag("situational") || objective === "control") {
    const candidates = data.items.filter((i) => i.isActive && i.tier <= 4 && i.cost <= result.souls / 4);
    const situ = situationalOptions(data, ctx, result.items.map((i) => i.className), candidates);
    if (situ.length) {
      console.log(`\nAlternativas situacionais (troca na build final, pelo tipo de luta):`);
      for (const s of situ) console.log(`  ${s.label.padEnd(26)} ${s.item.name}${s.replaces ? ` no lugar de ${s.replaces.item.name}` : ""}: jogadas +${f(s.gain, 1)}/min (${s.mechanism})`);
    }
  }
  const issues = validateRoute(data, result, input.itemSlots ?? BASE_ITEM_SLOTS);
  console.log(`\nRegras da loja na rota: ${issues.length === 0 ? "ok (souls, upgrades, vendas, slots, ativos, pontos de habilidade)" : issues.map((x) => `passo ${x.step} ${x.item}: ${x.problem}`).join("; ")}`);
  const stale = reviewStatus(data).filter((r) => r.stale);
  console.log(`Mecânicas revisadas: ${reviewStatus(data).length} definições; ${stale.length ? `desatualizadas: ${stale.map((r) => `${r.review.name} (${r.changed.map((c) => `${c.key} ${c.reviewed}→${c.now}`).join(", ")})`).join("; ")}` : `todas conferem com o patch ${data.meta.clientVersion}`}`);
}

const meta = heroMeta(data, heroForSpike.id);
const v = result.vitality;
if (v) {
  const when = v.reachedAt === null ? "não acontece nesta build" : `acontece com ${v.reachedAt} souls gastos (~${f(v.reachedMinute ?? 0)} min)`;
  const rule = v.enforced
    ? v.ok
      ? "dentro do prazo"
      : "FORA do prazo (itens obrigatórios ou orçamento impediram)"
    : `regra não se aplica: a build tem menos souls que o prazo (${v.invested} em vitality até agora)`;
  console.log(`
Pico de vitality (${v.target} souls): ${when}. Prazo: ${v.deadline} souls (~${f(v.deadlineMinute)} min). ${rule}.`);
}
if (meta) {
  console.log(`Com ${result.souls} souls, ${result.hero} costuma estar no minuto ~${f(minuteForSouls(data, heroForSpike.id, result.souls))} (média de ${meta.matches} partidas).`);
  const windows = powerWindows(meta).map((w) => `${w.bucket.fromMin}${w.bucket.toMin ? `-${w.bucket.toMin}` : "+"} min: ${f(w.winrate * 100, 1)}%`);
  console.log(`Winrate por duração da partida: ${windows.join(" | ")}`);

  const rates = itemPickRates(data, heroForSpike.id, result.items);
  console.log(`
Quanto os jogadores compram os itens desta build com ${result.hero}:`);
  for (const item of result.items) {
    const r = rates.get(item.className);
    console.log(`  ${item.name.padEnd(26)} ${r == null ? "quase nunca" : `${f(r * 100)}% das partidas`}`);
  }

  const comparisons = compareWithPopular(data, result, input);
  for (const c of comparisons) {
    const cm = c.result.metrics;
    console.log(`
Build publicada "${c.build.name}" (${c.build.matches} partidas, ${f(c.winrate * 100, 1)}% de vitória), cortada em ${result.souls} souls:`);
    console.log(`  Itens: ${c.items.map((i) => i.name).join(", ")}`);
    console.log(`  Pontuação no motor: ${f(c.result.score, 2)}x (app: ${f(result.score, 2)}x) | DPS total ${f(cm.totalDps)} (app ${f(m.totalDps)}) | vida efetiva ${f(cm.ehp)} (app ${f(m.ehp)})`);
    console.log(`  Em comum: ${c.shared.map((i) => i.name).join(", ") || "nenhum"}`);
    console.log(`  Só no app: ${c.onlyApp.map((i) => i.name).join(", ") || "nenhum"}`);
    console.log(`  Só na publicada: ${c.onlyPopular.map((i) => i.name).join(", ") || "nenhum"}`);
    const cv = c.result.vitality;
    if (cv) console.log(`  Pico de vitality: ${cv.reachedAt === null ? "não acontece" : `com ${cv.reachedAt} souls (~${f(cv.reachedMinute ?? 0)} min)`}`);
  }
}

if (flag("meta")) {
  const hero = findHero(data, heroName);
  const url = `https://api.deadlock-api.com/v1/analytics/item-stats?hero_id=${hero.id}&min_matches=200`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()) as { item_id: number; wins: number; losses: number; matches: number }[];
    const byId = new Map(rows.map((r) => [r.item_id, r]));
    const totalWins = rows.reduce((s, r) => s + r.wins, 0);
    const totalMatches = rows.reduce((s, r) => s + r.matches, 0);
    console.log(`\nWinrate real com ${hero.name} (deadlock-api.com; média dos itens ${f((totalWins / totalMatches) * 100, 1)}%):`);
    for (const item of result.items) {
      const r = byId.get(item.id);
      console.log(r ? `  ${item.name.padEnd(26)} ${f((r.wins / r.matches) * 100, 1)}% em ${r.matches} partidas` : `  ${item.name.padEnd(26)} sem dados suficientes`);
    }
    console.log(`  (winrate mostra correlação com vitória, não que o item cause a vitória)`);
  } catch (err) {
    console.log(`\nNão foi possível consultar o winrate: ${(err as Error).message}`);
  }
}
