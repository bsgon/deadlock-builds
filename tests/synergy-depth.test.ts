import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { buildGraph, heroItemFit, itemPairLinks, itemsForHero, linksBetween, linksFrom, topLinks } from "../src/interactions/synergy.ts";

const data = loadSnapshot();
const graph = buildGraph(data);
const node = (name: string) => graph.itemNode.get(data.items.find((i) => i.name === name)!.className)!;
const hero = (name: string) => data.heroes.find((h) => h.name === name)!;
const rank = (heroName: string, item: string) => itemsForHero(graph, hero(heroName)).findIndex((f) => f.item.name === item) + 1 || Infinity;

describe("interações conhecidas (wiki)", () => {
  const id = (name: string) => data.items.find((i) => i.name === name)!.className;
  const withKnowledge = (relation: "synergy" | "anti", strength: 1 | 2 | 3) =>
    buildGraph({
      ...data,
      knowledge: [
        { a: id("Spirit Snatch"), b: id("Healbane"), aName: "Spirit Snatch", bName: "Healbane", relation, strength, mechanism: "exemplo de teste", source: { url: "https://deadlock.wiki/Spirit_Snatch", heading: "Notes" } },
      ],
    });
  const pairScore = (g: ReturnType<typeof buildGraph>) =>
    itemPairLinks(g, data.items.find((i) => i.name === "Spirit Snatch")!, data.items.find((i) => i.name === "Healbane")!).reduce((s, l) => s + l.score, 0);

  it("sinergia da wiki soma mais que as regras e traz o link da fonte", () => {
    const base = pairScore(buildGraph({ ...data, knowledge: [] }));
    const g = withKnowledge("synergy", 2);
    expect(pairScore(g)).toBeGreaterThan(base + 1);
    const link = itemPairLinks(g, data.items.find((i) => i.name === "Spirit Snatch")!, data.items.find((i) => i.name === "Healbane")!).find((l) => l.rule === "wiki:synergy")!;
    expect(link.source).toBe("https://deadlock.wiki/Spirit_Snatch");
  });

  it("anti da wiki tira pontos e não vira motivo de sugestão", () => {
    const g = withKnowledge("anti", 3);
    const links = itemPairLinks(g, data.items.find((i) => i.name === "Spirit Snatch")!, data.items.find((i) => i.name === "Healbane")!);
    expect(links.find((l) => l.rule === "wiki:anti")!.score).toBeLessThan(0);
    expect(topLinks(links, 5).some((l) => l.rule === "wiki:anti")).toBe(false);
  });

  it("interação da wiki com um herói entra no encaixe do item com esse herói", () => {
    const abrams = hero("Abrams");
    const g = buildGraph({
      ...data,
      knowledge: [{ a: id("Healbane"), b: `hero:${abrams.id}`, aName: "Healbane", bName: "Abrams", relation: "synergy", strength: 3, mechanism: "exemplo", source: { url: "https://deadlock.wiki/Abrams", heading: "Notes" } }],
    });
    const before = heroItemFit(graph, abrams, data.items.find((i) => i.name === "Healbane")!).score;
    expect(heroItemFit(g, abrams, data.items.find((i) => i.name === "Healbane")!).score).toBeGreaterThan(before + 2);
  });
});

describe("base de interações extraída da wiki", () => {
  const known = data.knowledge ?? [];
  const ids = new Set([...data.items.map((i) => i.className), ...data.abilities.map((a) => a.className), ...data.heroes.map((h) => `hero:${h.id}`)]);

  it("existe, aponta só para itens, habilidades e heróis do snapshot e cita a fonte", () => {
    expect(known.length).toBeGreaterThan(100);
    for (const i of known) {
      expect(ids.has(i.a), i.aName).toBe(true);
      expect(ids.has(i.b), i.bName).toBe(true);
      expect(i.source.url).toMatch(/^https:\/\/deadlock\.wiki\//);
      expect(i.mechanism.length).toBeGreaterThan(10);
    }
  });

  it("a revisão manual foi aplicada: sem contra-jogo, sem pares só de habilidades, relações corrigidas", () => {
    const itemIds = new Set(data.items.map((i) => i.className));
    expect(known.every((i) => itemIds.has(i.a) || itemIds.has(i.b))).toBe(true);
    const pair = (x: string, y: string) => known.filter((i) => [i.aName, i.bName].sort().join("+") === [x, y].sort().join("+"));
    expect(pair("Flying Cloak", "Slowing Hex")).toEqual([]);
    expect(pair("Tankbuster", "Silencer")).toEqual([]);
    expect(pair("Heavy Barrage", "Enduring Speed").map((i) => i.relation)).toEqual(["synergy"]);
    expect(pair("Lightning Scroll", "Close The Deal").map((i) => i.relation)).toEqual(["anti"]);
  });

  it("Viscous: Puddle Punch conta como melee, e os itens de melee sobem com o motivo da wiki", () => {
    const viscous = hero("Viscous");
    const top = itemsForHero(graph, viscous).slice(0, 10).map((f) => f.item.name);
    expect(top).toContain("Spirit Strike");
    const fit = heroItemFit(graph, viscous, data.items.find((i) => i.name === "Melee Charge")!);
    expect(fit.links.some((l) => l.rule === "wiki:synergy" && l.source)).toBe(true);
  });
});

describe("itens de Brawl (tier 5)", () => {
  it("não aparecem em nenhum lugar: o projeto cobre só partidas normais e ranqueadas", () => {
    expect(data.items.every((i) => i.tier <= 4)).toBe(true);
    expect(data.items.some((i) => i.name === "Frostbite Charm")).toBe(false);
  });
});

describe("sinergias com profundidade", () => {
  it("empilhar o mesmo stat não é sinergia", () => {
    for (const a of graph.tagged.items) {
      for (const b of graph.tagged.items) {
        for (const l of linksFrom(a, b)) {
          if (!l.rule.startsWith("feed:")) continue;
          const stat = l.rule.slice(5) as keyof typeof b.gives;
          expect(b.gives[stat], `${a.name} → ${b.name} (${stat})`).toBeUndefined();
        }
      }
    }
  });

  it("stat natural da árvore vale menos que o mesmo stat cruzando árvores", () => {
    // Mesmo item que dá Spirit Power alimentando um item de spirit e um de arma que querem Spirit Power.
    const giver = graph.tagged.items.find((n) => n.gives.spiritPower === "always" && n.slot !== "spirit")
      ?? graph.tagged.items.find((n) => n.gives.spiritPower === "always")!;
    const per = (slot: string) =>
      graph.tagged.items
        .filter((n) => n.slot === slot && n.wants.spiritPower && !n.gives.spiritPower && n.id !== giver.id)
        .map((n) => linksFrom(giver, n).find((l) => l.rule === "feed:spiritPower")!.score / n.wants.spiritPower!)
        .filter((s) => s > 0);
    const natural = Math.max(...per("spirit"));
    const cross = Math.max(...per("weapon"));
    expect(cross).toBeGreaterThan(natural * 3);
  });

  it("Infernal Resilience (lifesteal no melee, 2º upgrade) marca o kit do Abrams como corpo a corpo", () => {
    const kit = graph.tagged.kits.get(hero("Abrams").id)!;
    expect(kit.find((n) => n.name === "Infernal Resilience")!.triggers).toContain("onMelee");
  });

  it("itens de melee sobem para Abrams e Billy e afundam para Haze", () => {
    for (const item of ["Spirit Snatch", "Crushing Fists"]) {
      expect(rank("Abrams", item), item).toBeLessThanOrEqual(10);
      expect(rank("Billy", item), item).toBeLessThanOrEqual(10);
      expect(rank("Haze", item), item).toBeGreaterThan(40);
    }
    for (const item of ["Lifestrike", "Melee Charge"]) expect(rank("Abrams", item), item).toBeLessThan(rank("Haze", item));
  });

  it("o motivo de melee cita o uso real do herói, e herói sem melee não recebe esse motivo", () => {
    const abrams = heroItemFit(graph, hero("Abrams"), data.items.find((i) => i.name === "Lifestrike")!);
    expect(abrams.links.some((l) => l.rule === "meta:melee" && l.score > 0 && /% das partidas/.test(l.reason))).toBe(true);
    const haze = heroItemFit(graph, hero("Haze"), data.items.find((i) => i.name === "Lifestrike")!);
    expect(haze.links.find((l) => l.rule === "meta:melee")!.score).toBeLessThan(0);
  });

  it("repetir a mesma regra com várias habilidades soma menos que regras diferentes", () => {
    const fit = heroItemFit(graph, hero("Seven"), data.items.find((i) => i.name === "Spirit Shredder")!);
    const raw = fit.links.reduce((s, l) => s + l.score, 0);
    expect(fit.score).toBeLessThan(raw);
  });

  it("Headshot Booster não tem como melhor parceiro outro item que só pede headshot", () => {
    const sameCondition = linksBetween(node("Headshot Booster"), node("Crippling Headshot")).filter((l) => l.rule === "shared:onHeadshot");
    expect(sameCondition.length).toBeGreaterThan(0);
    expect(sameCondition.every((l) => l.score < 0.5)).toBe(true);
  });
});
