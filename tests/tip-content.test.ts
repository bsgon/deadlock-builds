import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { findHero, findItem, heroAbilities } from "../src/engine/index.ts";
import { abilityTip, itemTip, pickText } from "../web/tip-content.ts";

const data = loadSnapshot();
const infernus = findHero(data, "Infernus");

describe("mouse-over", () => {
  it("item: preço, atributos, efeito e taxa de compra do herói", () => {
    const item = findItem(data, "Spirit Burn");
    const tip = itemTip(data, infernus.id, item);
    expect(tip.title).toBe("Spirit Burn");
    expect(tip.meta).toContain("tier 4");
    expect(tip.sections.some((s) => s.text?.includes("burn"))).toBe(true);
    expect(tip.sections.flatMap((s) => s.stats ?? [])).toContainEqual(["Ability Range", "+6%"]);
    expect(tip.footer).toMatch(/\d+% das partidas de Infernus/);
  });

  it("item: não mostra valor sentinela nem linha repetida", () => {
    for (const item of data.items) {
      for (const s of itemTip(data, null, item).sections) {
        const lines = (s.stats ?? []).map((l) => l.join("|"));
        expect(new Set(lines).size, item.name).toBe(lines.length);
        expect(lines, item.name).not.toContain("Charge Delay|−1 s");
      }
    }
  });

  it("sem herói ou sem estatísticas não há taxa de compra", () => {
    const item = findItem(data, "Spirit Burn");
    expect(pickText(data, null, item)).toBe("");
    expect(pickText({ ...data, stats: undefined, elite: undefined }, infernus.id, item)).toBe("");
  });

  it("habilidade: descrição, recarga e os três upgrades", () => {
    const flameDash = heroAbilities(data, infernus).find((a) => a.name === "Flame Dash")!;
    const tip = abilityTip(flameDash);
    expect(tip.sections[0]?.stats).toContainEqual(["Cooldown", "38 s"]);
    expect(tip.sections.map((s) => s.title).filter(Boolean)).toEqual(["Upgrade 1", "Upgrade 2", "Upgrade 3"]);
    expect(tip.sections[1]?.stats).toContainEqual(["Cooldown", "−12 s"]);
  });

  it("todo item e toda habilidade têm conteúdo", () => {
    for (const i of data.items) expect(itemTip(data, infernus.id, i).sections.length, i.name).toBeGreaterThan(0);
    for (const a of data.abilities) expect(abilityTip(a).sections.length, a.name).toBeGreaterThan(0);
  });
});
