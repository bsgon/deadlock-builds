import { afterEach, describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { VITALITY_SPIKE_SOULS } from "../src/engine/rules.ts";
import { detectLang, setLang, tr, trData } from "../src/i18n.ts";
import { vitalitySpikeOf } from "../src/meta/stats.ts";
import { archetypeWeights } from "../src/optimizer/archetype.ts";
import { OBJECTIVES } from "../src/optimizer/metrics.ts";
import { optimize } from "../src/optimizer/optimize.ts";

const data = loadSnapshot();
const byClass = new Map(data.items.map((i) => [i.className, i]));
const souls = (r: ReturnType<typeof optimize>, slot: string) => r.items.filter((i) => i.slot === slot).reduce((s, i) => s + i.cost, 0);

describe("padrão do arquétipo", () => {
  it("pesa cada métrica pelo que os itens do arquétipo fazem com o herói", () => {
    // Spirit Rend é slot de arma, mas o ganho dele é em spirit.
    const items = ["Boundless Spirit", "Spirit Rend"].map((n) => data.items.find((i) => i.name === n)!);
    const w = archetypeWeights(data, "Infernus", items, 50_000);
    expect(w.spiritDps!).toBeGreaterThan(w.gunDps ?? 0);
    expect(w.ehpFloor).toBe(OBJECTIVES.optimized.ehpFloor);
    const sum = (w.gunDps ?? 0) + (w.spiritDps ?? 0) + (w.ehp ?? 0);
    expect(sum).toBeCloseTo(1);
  });

  it("sem itens cai na Otimizada", () => {
    expect(archetypeWeights(data, "Infernus", [], 50_000)).toBe(OBJECTIVES.optimized);
  });

  it("arquétipo de arma monta mais arma que spirit", () => {
    const items = ["upgrade_toxic_bullets", "upgrade_ricochet"].map((c) => byClass.get(c)).filter((i) => i !== undefined);
    const r = optimize(data, { hero: "Haze", objective: archetypeWeights(data, "Haze", items, 30_000), souls: 30_000, itemSlots: 12, matchWeight: 0 });
    expect(souls(r, "weapon")).toBeGreaterThan(souls(r, "spirit"));
  });
});

describe("tanque/sustain", () => {
  it("dá mais vida na luta que a Otimizada", () => {
    for (const hero of ["Abrams", "Haze"]) {
      const tank = optimize(data, { hero, objective: "survival", souls: 30_000, itemSlots: 12, matchWeight: 0 });
      const opt = optimize(data, { hero, objective: "optimized", souls: 30_000, itemSlots: 12, matchWeight: 0 });
      expect(tank.metrics.fightHp).toBeGreaterThan(opt.metrics.fightHp);
    }
  }, 60_000);
});

describe("pico de vitality pela média do herói", () => {
  it("cai entre o early e o late game para quem tem estatísticas", () => {
    const heroId = data.heroes.find((h) => h.name === "Infernus")!.id;
    const spike = vitalitySpikeOf(data, heroId, VITALITY_SPIKE_SOULS)!;
    expect(spike.minute).toBeGreaterThan(10);
    expect(spike.minute).toBeLessThan(40);
    expect(spike.souls).toBeGreaterThan(VITALITY_SPIKE_SOULS);
  });

  it("sem estatísticas não exige nada", () => {
    expect(vitalitySpikeOf({ ...data, stats: undefined }, 1, VITALITY_SPIKE_SOULS)).toBeNull();
  });
});

describe("idioma", () => {
  afterEach(() => setLang("pt"));

  it("português só quando o navegador pede pt", () => {
    expect(detectLang(["pt-BR", "en"])).toBe("pt");
    expect(detectLang(["pt"])).toBe("pt");
    expect(detectLang(["pt-PT"])).toBe("pt");
    expect(detectLang(["en-US", "pt-BR"])).toBe("en");
    expect(detectLang(["es"])).toBe("en");
    expect(detectLang([])).toBe("en");
  });

  it("tr e trData seguem o idioma ativo", () => {
    expect(tr("Arma", "Weapon")).toBe("Arma");
    setLang("en", { Olá: "Hello" });
    expect(tr("Arma", "Weapon")).toBe("Weapon");
    expect(trData("Olá")).toBe("Hello");
    expect(trData("sem tradução")).toBe("sem tradução");
    setLang("pt", { Olá: "Hello" });
    expect(trData("Olá")).toBe("Olá");
  });
});
