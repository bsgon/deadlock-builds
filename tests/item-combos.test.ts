import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { combosOf, ITEM_COMBOS, pairEvidence, recipeOf } from "../src/knowledge/item-combos.ts";

const data = loadSnapshot();
const item = (name: string) => data.items.find((i) => i.name === name);

describe("combos de T4", () => {
  it("todo T4 da loja tem pelo menos quatro combos", () => {
    const thin = data.items.filter((i) => i.tier === 4 && ITEM_COMBOS.filter((c) => c.t4 === i.name).length < 4).map((i) => i.name);
    expect(thin).toEqual([]);
  });

  it("todo combo liga um T4 a um T2/T3 que existe e não é componente dele", () => {
    const bad = ITEM_COMBOS.filter((c) => {
      const t4 = item(c.t4);
      const partner = item(c.partner);
      return t4?.tier !== 4 || !partner || partner.tier < 2 || partner.tier > 3 || recipeOf(data, t4).has(partner.className);
    });
    expect(bad.map((c) => `${c.t4} + ${c.partner}`)).toEqual([]);
  });

  it("não há par repetido nem texto vazio", () => {
    const keys = ITEM_COMBOS.map((c) => `${c.t4}|${c.partner}`);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
    expect(ITEM_COMBOS.filter((c) => !c.pt || !c.en)).toEqual([]);
  });

  it("nenhum combo contradiz uma interação ruim da wiki", () => {
    const pairs = (relation: string) => new Set((data.knowledge ?? []).filter((k) => k.relation === relation).flatMap((k) => [`${k.aName}|${k.bName}`, `${k.bName}|${k.aName}`]));
    const anti = pairs("anti");
    const synergy = pairs("synergy");
    expect(ITEM_COMBOS.map((c) => `${c.t4}|${c.partner}`).filter((k) => anti.has(k) && !synergy.has(k))).toEqual([]);
  });

  it("quando o texto diz que o T4 escala com duração ou alcance, os dados confirmam", () => {
    const stat: Record<string, string> = { "Superior Duration": "ETechDuration", "Greater Expansion": "ETechRange" };
    const bad = ITEM_COMBOS.filter((c) => {
      const wanted = stat[c.partner];
      if (!wanted || !/escalam? com (duração|alcance)/.test(c.pt)) return false;
      return !Object.values(item(c.t4)!.properties).some((p) => p.scale?.stats.includes(wanted));
    });
    expect(bad.map((c) => `${c.t4} + ${c.partner}`)).toEqual([]);
  });

  it("nenhum combo é evitado pelos jogadores, e os principais não ficam abaixo do esperado", () => {
    const low = ITEM_COMBOS.filter((c) => {
      const e = pairEvidence(data, item(c.t4)!, item(c.partner)!);
      return e && e.lift < (c.strength === 3 ? 0.9 : 0.8);
    });
    expect(low.map((c) => `${c.t4} + ${c.partner}`)).toEqual([]);
  });

  it("Vortex Web: agrupar e depois bater em área, nos dois sentidos da consulta", () => {
    const vortex = combosOf(data, item("Vortex Web")!).map((c) => c.partner.name);
    expect(vortex).toEqual(expect.arrayContaining(["Alchemical Fire", "Silence Wave", "Cold Front", "Greater Expansion"]));
    expect(combosOf(data, item("Alchemical Fire")!).map((c) => c.t4.name)).toContain("Vortex Web");
    expect(pairEvidence(data, item("Vortex Web")!, item("Alchemical Fire")!)!.lift).toBeGreaterThan(1.3);
  });
});
