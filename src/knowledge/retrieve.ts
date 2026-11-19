/**
 * Índice e busca do corpus da wiki (só Node: lê data/raw/wiki).
 *
 * Cada página vira trechos curtos (um parágrafo ou um item de lista). Cada trecho
 * guarda quais itens, habilidades e heróis cita. A busca por um par de entidades
 * devolve os trechos em que as duas aparecem, ou em que a página de uma cita a
 * outra: é onde a comunidade descreve como elas interagem.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameData } from "../data/types.ts";
import type { WikiPage } from "./corpus.ts";

export type EntityKind = "item" | "ability" | "hero";

export interface Entity {
  /** class_name do item/habilidade, ou `hero:<id>`. */
  id: string;
  name: string;
  kind: EntityKind;
  /** Herói dono (habilidades). */
  heroId?: number;
}

export interface Chunk {
  page: string;
  url: string;
  heading: string;
  text: string;
  /** Primeira frase da seção: dá o contexto de linhas de tabela e itens de lista. */
  lead: string;
  /** Entidade dona da página (o item ou herói da página). */
  owner: Entity | null;
  /** Entidades citadas no trecho (sem a dona). */
  mentions: Entity[];
}

const defaultDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "raw", "wiki");

export function loadCorpus(dir = defaultDir): WikiPage[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as WikiPage);
}

export function entitiesOf(data: GameData): Entity[] {
  return [
    ...data.items.map((i) => ({ id: i.className, name: i.name, kind: "item" as const })),
    ...data.abilities.map((a) => ({ id: a.className, name: a.name, kind: "ability" as const, heroId: a.heroId })),
    ...data.heroes.map((h) => ({ id: `hero:${h.id}`, name: h.name, kind: "hero" as const })),
  ];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Nomes curtos e genéricos demais para buscar no texto (ex.: "Rend", "Flight"). */
const MIN_NAME = 4;

export function buildIndex(data: GameData, pages: WikiPage[]): Chunk[] {
  const entities = entitiesOf(data).filter((e) => e.name.length >= MIN_NAME);
  // Nomes mais longos primeiro, para "Improved Spirit" não virar também "Spirit".
  const sorted = [...entities].sort((a, b) => b.name.length - a.name.length);
  const patterns = sorted.map((e) => ({ e, re: new RegExp(`(?<![\\w'])${escape(e.name)}(?![\\w'])`, "i") }));
  const byName = new Map(entities.map((e) => [e.name.toLowerCase(), e]));
  const chunks: Chunk[] = [];

  for (const page of pages) {
    const pageOwner = byName.get(page.title.toLowerCase()) ?? null;
    for (const section of page.sections) {
      // Na página do herói, a seção de cada habilidade pertence à habilidade.
      const sectionOwner =
        pageOwner?.kind === "hero"
          ? (entities.find((e) => e.kind === "ability" && e.name.toLowerCase() === section.heading.toLowerCase() && `hero:${e.heroId}` === pageOwner.id) ?? pageOwner)
          : pageOwner;
      const pieces = section.text
        .split(/\n/)
        .map((s) => s.replace(/&#\d+;/g, " ").replace(/^- /, "").trim())
        .filter((s) => s.length > 20);
      const lead = (pieces[0] ?? "").slice(0, 300);
      for (const text of pieces) {
        let rest = text;
        const mentions: Entity[] = [];
        for (const { e, re } of patterns) {
          if (!re.test(rest)) continue;
          if (e.id !== sectionOwner?.id) mentions.push(e);
          rest = rest.replace(new RegExp(re.source, "gi"), " ");
        }
        chunks.push({ page: page.title, url: page.url, heading: section.heading, text, lead: text === pieces[0] ? "" : lead, owner: sectionOwner, mentions });
      }
    }
  }
  return chunks;
}

/** Trechos que ligam as duas entidades (citadas juntas, ou uma na página da outra). */
export function retrievePair(chunks: Chunk[], a: string, b: string): Chunk[] {
  const has = (c: Chunk, id: string) => c.owner?.id === id || c.mentions.some((m) => m.id === id);
  return chunks.filter((c) => has(c, a) && has(c, b));
}

/** Tudo o que o corpus diz sobre uma entidade. */
export function retrieveEntity(chunks: Chunk[], id: string): Chunk[] {
  return chunks.filter((c) => c.owner?.id === id || c.mentions.some((m) => m.id === id));
}
