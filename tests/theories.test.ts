import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { buildGraph, heroItemFit } from "../src/interactions/synergy.ts";
import type { Theory } from "../src/knowledge/theories.ts";
import { optimize } from "../src/optimizer/optimize.ts";

const data = loadSnapshot();
const theories = data.theories ?? [];
const hero = (name: string) => data.heroes.find((h) => h.name === name)!;
const item = (name: string) => data.items.find((i) => i.name === name)!;

describe("theorycraft das builds publicadas", () => {
  it("existe para todos os heróis e aponta só para itens do snapshot (sem tier 5)", () => {
    expect(theories.length).toBeGreaterThan(300);
    expect(new Set(theories.map((t) => t.heroId)).size).toBe(data.heroes.length);
    const classes = new Set(data.items.map((i) => i.className));
    for (const t of theories) {
      expect(["archetype", "combo", "timing", "late-swap", "situational"]).toContain(t.kind);
      for (const c of t.items) expect(classes.has(c), `${t.hero}: ${c}`).toBe(true);
      expect(t.builds.length).toBeGreaterThan(0);
      expect(t.claim.length).toBeGreaterThan(15);
    }
  });

  it("troca de fim de jogo tem o vendido e o comprado", () => {
    for (const t of theories.filter((x) => x.kind === "late-swap")) expect(t.items.length, t.title).toBeGreaterThanOrEqual(2);
  });

  it("arquétipo de melee do Abrams entra no encaixe dos itens de melee, com o número de builds", () => {
    const fit = heroItemFit(buildGraph(data), hero("Abrams"), item("Melee Charge"));
    expect(fit.links.some((l) => l.rule.startsWith("theory:") && /builds? publicadas?/.test(l.reason))).toBe(true);
  });

  it("troca de fim de jogo da comunidade é reconhecida na montagem e marcada na ordem de compra", () => {
    const plain = optimize({ ...data, theories: [] }, { hero: "Haze", objective: "optimized", souls: 40000 });
    const sale = plain.order.find((s) => s.sold)!;
    expect(sale).toBeDefined();
    const theory: Theory = {
      hero: "Haze", heroId: hero("Haze").id, kind: "late-swap", items: [sale.sold!.className, sale.item.className],
      itemNames: [sale.sold!.name, sale.item.name], title: "troca de teste", claim: "troca usada só no teste", builds: [1, 2, 3], favorites: 0,
    };
    const r = optimize({ ...data, theories: [theory] }, { hero: "Haze", objective: "optimized", souls: 40000 });
    const marked = r.order.find((s) => s.community);
    expect(marked?.community).toEqual({ title: "troca de teste", builds: 3 });
    expect(marked?.sold?.className).toBe(sale.sold!.className);
  }, 60_000);

  it("teoria contrariada pelos dados não soma; confirmada soma mais que sem conclusão", () => {
    const base: Theory = { ...theories.find((t) => t.kind === "combo")!, evidence: undefined };
    const score = (verdict: "supported" | "unclear" | "contradicted") => {
      const g = buildGraph({ ...data, theories: [{ ...base, evidence: { verdict, lift: 2, matches: 1000 } }] });
      const h = data.heroes.find((x) => x.id === base.heroId)!;
      const it = data.items.find((i) => i.className === base.items[0])!;
      return heroItemFit(g, h, it).links.filter((l) => l.rule.startsWith("theory:")).reduce((s, l) => s + l.score, 0);
    };
    expect(score("contradicted")).toBe(0);
    expect(score("supported")).toBeGreaterThan(score("unclear"));
  });
});
