import { describe, expect, it } from "vitest";
import { slope, within, type Row } from "../src/meta/validation.ts";

/** Dois heróis com médias diferentes; y cresce 0,05 por unidade de x[0] dentro de cada um. */
const rows = (): Row[] =>
  Array.from({ length: 400 }, (_, i) => {
    const group = i % 2;
    const a = Math.sin(i * 12.9898) * 2;
    const b = Math.cos(i * 78.233) * 3;
    // O herói 1 vence mais e tem x maior: sem centrar por herói, isso inflaria o efeito.
    return { group, cluster: Math.floor(i / 12), y: 0.05 * a + group, x: [a + 10 * group, b] };
  });

describe("contas da validação das rotas", () => {
  it("within tira a diferença entre heróis e põe x em desvios-padrão", () => {
    const c = within(rows());
    for (const g of [0, 1]) {
      const mine = c.filter((r) => r.group === g);
      expect(mine.reduce((s, r) => s + r.y, 0)).toBeCloseTo(0, 8);
      expect(mine.reduce((s, r) => s + r.x[0]!, 0)).toBeCloseTo(0, 8);
    }
    expect(c.reduce((s, r) => s + r.x[0]! ** 2, 0) / c.length).toBeCloseTo(1, 8);
  });

  it("slope recupera o efeito por desvio-padrão, sozinho e descontando outra coluna", () => {
    const c = within(rows());
    const sd = Math.sqrt(2); // desvio de 2·sin(...)
    expect(slope(c, [0])[0]!).toBeCloseTo(0.05 * sd, 2);
    const [a, b] = slope(c, [0, 1]);
    expect(a!).toBeCloseTo(0.05 * sd, 2);
    expect(Math.abs(b!)).toBeLessThan(1e-6);
  });

  it("colunas iguais não quebram a conta", () => {
    const c = within(rows().map((r) => ({ ...r, x: [r.x[0]!, r.x[0]!] })));
    expect(slope(c, [0, 1])).toEqual([0, 0]);
  });
});
