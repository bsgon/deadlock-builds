/** Contas da validação das rotas (scripts/validate-routes.ts). */
export interface Row {
  /** Grupo do centramento (herói). */
  group: number;
  /** Unidade da reamostragem (partida). */
  cluster: number;
  y: number;
  x: number[];
}

/**
 * Tira a média de cada grupo de y e de x, e divide cada x pelo desvio-padrão
 * dentro dos grupos: sobra a comparação entre jogadores do mesmo herói.
 */
export function within(rows: Row[]): Row[] {
  const k = rows[0]?.x.length ?? 0;
  const sums = new Map<number, { n: number; y: number; x: number[] }>();
  for (const r of rows) {
    let s = sums.get(r.group);
    if (!s) sums.set(r.group, (s = { n: 0, y: 0, x: new Array<number>(k).fill(0) }));
    s.n++;
    s.y += r.y;
    r.x.forEach((v, i) => (s!.x[i]! += v));
  }
  const out = rows.map((r) => {
    const s = sums.get(r.group)!;
    return { ...r, y: r.y - s.y / s.n, x: r.x.map((v, i) => v - s.x[i]! / s.n) };
  });
  const sd = Array.from({ length: k }, (_, i) => Math.sqrt(out.reduce((a, r) => a + r.x[i]! ** 2, 0) / Math.max(1, out.length)) || 1);
  return out.map((r) => ({ ...r, x: r.x.map((v, i) => v / sd[i]!) }));
}

/** Coeficientes da regressão linear de y nas colunas pedidas (1 ou 2), sem intercepto (dados centrados). */
export function slope(rows: Row[], columns: [number] | [number, number]): number[] {
  const [a, b] = columns;
  let aa = 0;
  let ay = 0;
  let bb = 0;
  let ab = 0;
  let by = 0;
  for (const r of rows) {
    const xa = r.x[a]!;
    aa += xa * xa;
    ay += xa * r.y;
    if (b !== undefined) {
      const xb = r.x[b]!;
      bb += xb * xb;
      ab += xa * xb;
      by += xb * r.y;
    }
  }
  if (b === undefined) return [aa > 0 ? ay / aa : 0];
  const det = aa * bb - ab * ab;
  return Math.abs(det) < 1e-12 ? [0, 0] : [(ay * bb - by * ab) / det, (by * aa - ay * ab) / det];
}
