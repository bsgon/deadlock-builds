/**
 * Idioma da interface: português (pt-BR) ou inglês.
 *
 * O app escolhe pelo idioma do navegador: português quando o idioma principal é
 * pt (pt, pt-BR, pt-PT), inglês em qualquer outro caso. O idioma é um estado
 * global do módulo, definido uma vez na abertura (na página e no worker).
 *
 * Textos do código usam `tr("português", "English")` no ponto de uso. Textos que
 * vêm dos dados (teorias da comunidade, mecanismos tirados da wiki) são gerados em
 * português; `trData` troca pela tradução de data/snapshot/i18n-en.json quando
 * existe e devolve o original quando não (um dado novo ainda sem tradução).
 */
export type Lang = "pt" | "en";

let current: Lang = "pt";
let dictionary: Record<string, string> = {};

/** Idioma pelo navegador: o primeiro da lista de preferências decide. */
export function detectLang(languages: readonly string[]): Lang {
  return (languages[0] ?? "").toLowerCase().startsWith("pt") ? "pt" : "en";
}

/** Define o idioma e, para o inglês, as traduções dos textos dos dados (português → inglês). */
export function setLang(lang: Lang, translations: Record<string, string> = {}): void {
  current = lang;
  dictionary = lang === "en" ? translations : {};
}

export const lang = (): Lang => current;

/** Locale para Intl (números, datas). */
export const locale = (): string => (current === "en" ? "en-US" : "pt-BR");

/** Texto no idioma em uso. */
export const tr = (pt: string, en: string): string => (current === "en" ? en : pt);

/** Texto vindo dos dados (gerado em português), traduzido quando houver tradução. */
export const trData = (text: string): string => (current === "en" ? (dictionary[text] ?? text) : text);
