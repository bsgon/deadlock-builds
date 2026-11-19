/**
 * Corpus da base de conhecimento: páginas da wiki da comunidade (deadlock.wiki),
 * baixadas por `npm run wiki` em data/raw/wiki. Só existe localmente; o app
 * recebe apenas as interações extraídas (data/snapshot/interactions.json).
 */
export interface WikiSection {
  heading: string;
  text: string;
}

export interface WikiPage {
  title: string;
  url: string;
  revid: number;
  fetchedAt: string;
  sections: WikiSection[];
}
