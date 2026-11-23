import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import type { GameData } from "../src/data/types.ts";
import { findHero, heroAbilities } from "../src/engine/index.ts";
import { compareWithElite } from "../src/meta/compare.ts";
import { badgeName, eliteAbilityOrder, eliteMaxFirst, elitePath, type EliteStats } from "../src/meta/elite.ts";
import { optimize } from "../src/optimizer/optimize.ts";

const base = loadSnapshot();
const hero = findHero(base, "Haze");
const [a, b, c] = base.items.filter((i) => i.tier <= 2).map((i) => i.className);

/** Snapshot com um elite.json controlado: três itens com taxas e minutos conhecidos. */
function withElite(): GameData {
  const elite: EliteStats = {
    fetchedAt: "2026-11-22T00:00:00Z",
    days: 30,
    badge: 101,
    fallbackBadge: 91,
    share: 0.034,
    heroes: {
      [hero.id]: {
        heroId: hero.id,
        badge: 101,
        matches: 1000,
        wins: 520,
        items: {
          [a!]: { matches: 900, wins: 470, buyMinute: 9 },
          [b!]: { matches: 500, wins: 260, buyMinute: 3 },
          [c!]: { matches: 100, wins: 60, buyMinute: 5 },
          upgrade_nao_existe: { matches: 999, wins: 500, buyMinute: 1 },
        },
        maxFirst: [
          { slot: 3, matches: 600, wins: 310 },
          { slot: 1, matches: 200, wins: 100 },
        ],
        order: { slots: [3, 3, 1, 2, 3, 1, 4], matches: 80, wins: 44 },
      },
    },
  };
  return { ...base, elite };
}

describe("elo alto", () => {
  it("caminho: só itens acima da taxa mínima, na ordem do minuto médio", () => {
    const path = elitePath(withElite(), hero.id)!;
    // c fica abaixo dos 30%; o item desconhecido do snapshot é ignorado.
    expect(path.core).toEqual([b, a]);
    expect(path.name).toBe("Ascendant 1+");
    expect(path.matches).toBe(1000);
  });

  it("sem elite.json não há caminho nem comparação", () => {
    const data: GameData = { ...base };
    delete data.elite;
    expect(elitePath(data, hero.id)).toBeNull();
    const input = { hero: "Haze", objective: "weapon" as const, souls: 3000 };
    expect(compareWithElite(data, optimize(data, input), input)).toBeNull();
  });

  it("ordem de habilidades vira as habilidades do herói, com a fração das partidas", () => {
    const data = withElite();
    const order = eliteAbilityOrder(data, hero.id, heroAbilities(data, hero))!;
    expect(order.abilities.map((x) => x.slot)).toEqual([3, 3, 1, 2, 3, 1, 4]);
    expect(order.share).toBeCloseTo(0.08);
    const max = eliteMaxFirst(data, hero.id);
    expect(max[0]).toEqual({ slot: 3, share: 0.75 });
  });

  it("nome do badge", () => {
    expect(badgeName(101)).toBe("Ascendant 1");
    expect(badgeName(91)).toBe("Phantom 1");
    expect(badgeName(116)).toBe("Eternus 6");
  });

  it.runIf(base.elite !== undefined)("com os dados reais, o caminho do elo alto passa pelo motor nos mesmos souls", () => {
    const input = { hero: "Haze", objective: "weapon" as const, souls: 15_000 };
    const cmp = compareWithElite(base, optimize(base, input), input)!;
    expect(cmp).not.toBeNull();
    expect(cmp.items.length).toBeGreaterThan(3);
    expect(cmp.items.reduce((s, i) => s + i.cost, 0)).toBeLessThanOrEqual(15_000);
  });
});
