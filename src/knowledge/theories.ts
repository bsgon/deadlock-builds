/**
 * Theorycraft da comunidade: ideias de build extraídas das builds publicadas no
 * jogo (descrição, categorias e anotações dos autores), com o apoio de quantas
 * builds as citam e, depois, a checagem contra partidas reais.
 * Ficam em data/snapshot/theories.json (`npm run theory`).
 */
export type TheoryKind =
  /** Estilo de jogo do herói com os itens que o definem (ex.: Abrams arma de perto). */
  | "archetype"
  /** Itens que funcionam juntos, com o motivo. */
  | "combo"
  /** Item que muda a partida e quando comprar. */
  | "timing"
  /** Troca de fim de jogo: vender um item para comprar outro. */
  | "late-swap"
  /** Resposta a uma situação (contra muita cura, contra muito controle...). */
  | "situational";

export interface Theory {
  hero: string;
  heroId: number;
  kind: TheoryKind;
  /** class_name dos itens (na troca: primeiro o vendido, depois o comprado). */
  items: string[];
  itemNames: string[];
  /** Título curto, em pt-BR. */
  title: string;
  /** A ideia, com nossas palavras, em pt-BR (até ~30 palavras). */
  claim: string;
  /** Quando vale (ex.: "contra heróis de cura"), se a teoria for situacional. */
  condition?: string;
  /** Builds publicadas que sustentam a teoria (ids). */
  builds: number[];
  /** Favoritos somados dessas builds. */
  favorites: number;
  /** Checagem contra partidas reais (preenchida pelo `theory -- check`). */
  evidence?: {
    verdict: "supported" | "unclear" | "contradicted";
    /** Diferença de winrate (pontos percentuais) com a ideia vs sem ela. */
    lift: number;
    matches: number;
  };
}
