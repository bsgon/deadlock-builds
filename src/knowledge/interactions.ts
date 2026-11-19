/**
 * Interações conhecidas entre itens, habilidades e heróis, extraídas da wiki da
 * comunidade (RAG: `npm run wiki` + `npm run knowledge`). Ficam em
 * data/snapshot/interactions.json e entram no grafo de sinergias com o link da
 * fonte. O texto é nosso (paráfrase), não cópia da wiki.
 */
export interface Interaction {
  /** class_name do item/habilidade, ou `hero:<id>`. */
  a: string;
  b: string;
  aName: string;
  bName: string;
  /** "synergy": combinam de um jeito específico; "anti": atrapalham ou não funcionam juntos. */
  relation: "synergy" | "anti";
  /** 1 = detalhe útil; 2 = combinação forte; 3 = combinação que define a build. */
  strength: 1 | 2 | 3;
  /** Como funciona, em pt-BR, com nossas palavras (até ~25 palavras). */
  mechanism: string;
  source: { url: string; heading: string };
}
