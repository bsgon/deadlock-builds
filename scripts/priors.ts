/**
 * Compara as fontes do peso das partidas no otimizador: nenhuma, winrate por janela
 * de compra (windows.json), vitória acima do esperado pelo placar (wpa.json) e as
 * duas combinadas pela precisão (blend).
 *
 *   npm run priors [-- Haze Paige ...]
 *
 * Para cada herói monta a build padrão do app (Otimizada, 50.000 souls, 12 slots)
 * com cada fonte e mede:
 *   - elo alto: taxa média de compra dos itens da build entre os jogadores Ascendant+
 *     (elite.json), a referência que não vem de nenhuma das duas fontes;
 *   - janela / WPA: o Δ médio dos itens por cada fonte (cada uma favorece a si mesma;
 *     o interessante é o cruzamento);
 *   - pontos: pontuação do modelo, contra a build sem peso das partidas;
 *   - trocas: itens diferentes da build sem peso.
 */
import { loadSnapshot } from "../src/data/load.ts";
import type { Item } from "../src/data/types.ts";
import { VITALITY_SPIKE_SOULS } from "../src/engine/rules.ts";
import { heroElite } from "../src/meta/elite.ts";
import { minuteForSouls, vitalitySpikeOf } from "../src/meta/stats.ts";
import { tierPrior } from "../src/meta/windows.ts";
import { itemWpa } from "../src/meta/wpa.ts";
import { optimize, type OptimizeInput, type OptimizeResult } from "../src/optimizer/optimize.ts";

const data = loadSnapshot();
if (!data.wpa || !data.windows || !data.elite) throw new Error("Precisa de wpa.json, windows.json e elite.json (npm run wpa / windows / elite).");
const only = process.argv.slice(2);
const heroes = data.heroes.filter((h) => only.length === 0 || only.includes(h.name));

type Variant = "none" | "window" | "wpa" | "blend";
const VARIANTS: Variant[] = ["none", "window", "wpa", "blend"];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

interface Row {
  elite: number;
  window: number;
  wpa: number;
  score: number;
  swaps: number;
}
const rows: Record<Variant, Row[]> = { none: [], window: [], wpa: [], blend: [] };

for (const hero of heroes) {
  const spike = vitalitySpikeOf(data, hero.id, VITALITY_SPIKE_SOULS);
  const base: OptimizeInput = {
    hero: hero.name,
    objective: "optimized",
    souls: 50_000,
    itemSlots: 12,
    vitalitySpike: spike ? { souls: VITALITY_SPIKE_SOULS, deadline: spike.souls } : false,
  };
  const elite = heroElite(data, hero.id);
  const results = {} as Record<Variant, OptimizeResult>;
  for (const v of VARIANTS) results[v] = optimize(data, v === "none" ? { ...base, matchWeight: 0 } : { ...base, matchSource: v });
  const none = new Set(results.none.items.map((i) => i.className));
  const line: string[] = [];
  for (const v of VARIANTS) {
    const r = results[v];
    // Minuto de compra de cada item na rota, para o Δ por janela.
    const boughtAt = new Map<string, number>();
    for (const s of r.order) if (!boughtAt.has(s.item.className)) boughtAt.set(s.item.className, minuteForSouls(data, hero.id, s.earned));
    const items: Item[] = r.items;
    const row: Row = {
      elite: elite ? mean(items.map((i) => (elite.items[i.className]?.matches ?? 0) / elite.matches)) * 100 : 0,
      window: mean(items.flatMap((i) => tierPrior(data, hero.id, i, boughtAt.get(i.className) ?? 30)?.delta ?? [])),
      wpa: mean(items.flatMap((i) => itemWpa(data, hero.id, i)?.relative ?? [])),
      score: (r.score / results.none.score - 1) * 100,
      swaps: items.filter((i) => !none.has(i.className)).length,
    };
    rows[v].push(row);
    line.push(`${v} elo ${row.elite.toFixed(0)}% jan ${row.window.toFixed(1)} wpa ${row.wpa.toFixed(1)} pts ${row.score.toFixed(1)}% trocas ${row.swaps}`);
  }
  console.log(`${hero.name.padEnd(14)} ${line.join(" | ")}`);
}

console.log(`\nMédia em ${heroes.length} heróis (elo = taxa de compra no Ascendant+; jan/wpa = Δ médio em pp; pts = pontuação do modelo contra sem peso):`);
for (const v of VARIANTS) {
  const r = rows[v];
  console.log(
    `  ${v.padEnd(7)} elo ${mean(r.map((x) => x.elite)).toFixed(1)}%  jan ${mean(r.map((x) => x.window)).toFixed(2)}  wpa ${mean(r.map((x) => x.wpa)).toFixed(2)}  pts ${mean(r.map((x) => x.score)).toFixed(2)}%  trocas ${mean(r.map((x) => x.swaps)).toFixed(1)}`,
  );
}
