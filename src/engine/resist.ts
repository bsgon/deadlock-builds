/** Empilha percentuais multiplicativamente: 1 - Π(1 - p). Entrada e saída em %. */
export function stackMultiplicative(percents: number[]): number {
  let remaining = 1;
  for (const p of percents) remaining *= 1 - p / 100;
  return (1 - remaining) * 100;
}

/**
 * Resistência final em %: resistências empilhadas menos reduções (shred) empilhadas.
 * Pode ficar negativa, o que amplifica o dano recebido.
 */
export function finalResist(resists: number[], reductions: number[] = []): number {
  return stackMultiplicative(resists) - stackMultiplicative(reductions.map(Math.abs));
}

/** Multiplicador de dano recebido para uma resistência final em %. */
export function damageTakenMultiplier(resistPercent: number): number {
  return 1 - resistPercent / 100;
}

/** Vida efetiva contra um tipo de dano. */
export function effectiveHealth(health: number, resistPercent: number): number {
  const mult = damageTakenMultiplier(resistPercent);
  return mult <= 0 ? Number.POSITIVE_INFINITY : health / mult;
}
