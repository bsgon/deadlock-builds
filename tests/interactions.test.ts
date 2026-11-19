import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { findHero, findItem } from "../src/engine/index.ts";
import { OVERRIDES } from "../src/interactions/overrides.ts";
import { buildGraph, heroesForItem, heroesForPair, itemsForHero, linksBetween, linksFrom, partnersForItem } from "../src/interactions/synergy.ts";
import { tagItem } from "../src/interactions/tagger.ts";
import { DAMAGES, DEBUFFS, STATS, TRIGGERS, type Node } from "../src/interactions/tags.ts";

const data = loadSnapshot();
const graph = buildGraph(data);
const item = (name: string) => tagItem(findItem(data, name));
const kit = (name: string) => graph.tagged.kits.get(findHero(data, name).id)!;

/** Nó sintético para testar regras sem depender dos números do patch. */
function node(partial: Partial<Node>): Node {
  return { id: partial.name ?? "n", kind: "item", name: "n", heroId: null, gives: {}, applies: [], deals: [], triggers: [], wants: {}, ...partial };
}

describe("etiquetagem", () => {
  it("só usa etiquetas do vocabulário", () => {
    const all = [...graph.tagged.items, ...[...graph.tagged.kits.values()].flat()];
    for (const n of all) {
      for (const s of [...Object.keys(n.gives), ...Object.keys(n.wants)]) expect(STATS, n.name).toContain(s);
      for (const d of n.applies) expect(DEBUFFS, n.name).toContain(d);
      for (const d of n.deals) expect(DAMAGES, n.name).toContain(d);
      for (const t of n.triggers) expect(TRIGGERS, n.name).toContain(t);
    }
  });

  it("cada herói tem 4 habilidades e a arma", () => {
    for (const hero of data.heroes) {
      const nodes = graph.tagged.kits.get(hero.id)!;
      expect(nodes.filter((n) => n.kind === "ability"), hero.name).toHaveLength(4);
      expect(nodes.filter((n) => n.kind === "weapon"), hero.name).toHaveLength(1);
    }
  });

  it("stat inato é 'always' e stat de efeito é 'conditional'", () => {
    expect(item("Extra Spirit").gives.spiritPower).toBe("always");
    expect(item("Compress Cooldown").gives.cooldown).toBe("conditional");
  });

  it("reconhece gatilhos e debuffs de itens conhecidos", () => {
    const vuln = item("Mystic Vulnerability");
    expect(vuln.triggers).toContain("onSpiritDamage");
    expect(vuln.applies).toContain("spiritShred");

    const mysticShot = item("Mystic Shot");
    expect(mysticShot.triggers).toContain("onBullet");
    expect(mysticShot.deals).toContain("spirit");
    expect(mysticShot.wants.spiritPower).toBeGreaterThan(0);

    expect(item("Headshot Booster").triggers).toContain("onHeadshot");
    expect(item("Toxic Bullets").applies).toContain("antiHeal");
    expect(item("Knockdown").applies).toContain("stun");
  });

  it("quem dispara com dano de spirit não é marcado como causador de dano de spirit", () => {
    for (const name of ["Mystic Vulnerability", "Bullet Resist Shredder", "Suppressor", "Mystic Slow"]) {
      expect(item(name).deals, name).toEqual([]);
    }
  });

  it("penalidade no próprio usuário não vira debuff no inimigo", () => {
    expect(item("Metal Skin").applies).not.toContain("slow");
    expect(item("Cheat Death").applies).not.toContain("antiHeal");
  });

  it("arma de herói com escala de Spirit Power passa a querer Spirit Power", () => {
    const haze = kit("Haze").find((n) => n.kind === "weapon")!;
    expect(haze.wants.spiritPower).toBeGreaterThan(0);
    const infernus = kit("Infernus").find((n) => n.kind === "weapon")!;
    expect(infernus.wants.spiritPower).toBeUndefined();
  });

  it("toda correção manual aponta para um item ou habilidade que existe e explica o motivo", () => {
    const names = new Set([...data.items.map((i) => i.name), ...data.abilities.map((a) => a.name)]);
    for (const [name, o] of Object.entries(OVERRIDES)) {
      expect(names.has(name), name).toBe(true);
      expect(o.why.length, name).toBeGreaterThan(10);
    }
  });
});

describe("regras de sinergia", () => {
  it("recurso concedido alimenta quem escala com ele, e condicional vale menos", () => {
    const wants = node({ name: "alvo", wants: { spiritPower: 1 } });
    const always = linksFrom(node({ name: "a", gives: { spiritPower: "always" } }), wants);
    const conditional = linksFrom(node({ name: "c", gives: { spiritPower: "conditional" } }), wants);
    expect(always[0]!.rule).toBe("feed:spiritPower");
    expect(always[0]!.score).toBeGreaterThan(conditional[0]!.score);
  });

  it("dano de spirit frequente dispara mais forte que dano pontual", () => {
    const trigger = node({ name: "gatilho", triggers: ["onSpiritDamage"] });
    const dot = linksFrom(node({ name: "dot", deals: ["spiritDot"] }), trigger)[0]!;
    const burst = linksFrom(node({ name: "burst", deals: ["spirit"] }), trigger)[0]!;
    expect(dot.score).toBeGreaterThan(burst.score);
  });

  it("redução de resistência só combina com o tipo de dano certo", () => {
    const spiritShred = node({ name: "s", applies: ["spiritShred"] });
    const weapon = node({ name: "w", deals: ["weapon"] });
    const spirit = node({ name: "sp", deals: ["spirit"] });
    expect(linksFrom(spiritShred, weapon)).toEqual([]);
    expect(linksFrom(spiritShred, spirit).map((l) => l.rule)).toEqual(["shred:spirit"]);
  });

  it("bônus de imbuir não conta como sinergia entre dois itens", () => {
    const imbue = node({ name: "i", gives: { cooldown: "conditional" }, triggers: ["imbue"] });
    expect(linksFrom(imbue, node({ name: "item", wants: { cooldown: 1 } }))).toEqual([]);
    expect(linksFrom(imbue, node({ name: "hab", kind: "ability", wants: { cooldown: 1 } }))).toHaveLength(1);
  });

  it("um nó não tem sinergia consigo mesmo", () => {
    const n = item("Mystic Shot");
    expect(linksBetween(n, n)).toEqual([]);
  });
});

describe("consultas", () => {
  it("Mystic Shot e Mystic Vulnerability se alimentam nas duas direções", () => {
    const rules = linksBetween(item("Mystic Shot"), item("Mystic Vulnerability")).map((l) => l.rule);
    expect(rules).toContain("trigger:spiritDamage");
    expect(rules).toContain("shred:spirit");
  });

  it("parceiros vêm ordenados e não incluem o próprio item", () => {
    const target = findItem(data, "Mystic Vulnerability");
    const partners = partnersForItem(graph, target);
    expect(partners.length).toBeGreaterThan(5);
    expect(partners.map((p) => p.item.name)).not.toContain(target.name);
    for (let i = 1; i < partners.length; i++) expect(partners[i - 1]!.score).toBeGreaterThanOrEqual(partners[i]!.score);
  });

  it("item de spirit encaixa melhor num kit de spirit do que item de corpo a corpo", () => {
    const fits = itemsForHero(graph, findHero(data, "Infernus"));
    const score = (name: string) => fits.find((f) => f.item.name === name)?.score ?? 0;
    expect(score("Mystic Vulnerability")).toBeGreaterThan(score("Melee Charge"));
  });

  it("arma com mais balas por segundo aproveita mais efeitos por bala", () => {
    const ranked = heroesForItem(graph, findItem(data, "Tesla Bullets"));
    const rate = (name: string) => kit(name).find((n) => n.kind === "weapon")!.hitsPerSecond!;
    const fast = ranked[0]!.hero.name;
    const slow = ranked.at(-1)!.hero.name;
    expect(rate(fast)).toBeGreaterThan(rate(slow));
  });

  it("par de itens lista só heróis em que os dois encaixam", () => {
    const fits = heroesForPair(graph, findItem(data, "Tesla Bullets"), findItem(data, "Mystic Vulnerability"));
    expect(fits.length).toBeGreaterThan(0);
    for (const f of fits) {
      expect(f.a.score).toBeGreaterThan(0);
      expect(f.b.score).toBeGreaterThan(0);
      expect(f.score).toBeCloseTo(Math.min(f.a.score, f.b.score) + f.pair.score);
    }
  });
});
