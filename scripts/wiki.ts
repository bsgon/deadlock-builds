/**
 * Baixa as páginas da wiki da comunidade (deadlock.wiki) dos itens (até tier 4) e
 * dos heróis, e grava o texto por seção em data/raw/wiki/<página>.json.
 *
 *   npm run wiki [-- --refresh]
 *
 * É o corpus da base de conhecimento (src/knowledge): notas de interação entre
 * itens e habilidades que o jogo não descreve nos números. O texto da wiki fica
 * só local (data/raw, fora do app); o app mostra a interação com nossas palavras
 * e o link da página. Conteúdo da wiki: CC BY-NC-SA 4.0.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../src/data/load.ts";
import type { WikiPage, WikiSection } from "../src/knowledge/corpus.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "data", "raw", "wiki");
const refresh = process.argv.includes("--refresh");
const API = "https://deadlock.wiki/api.php";
const DELAY_MS = 1000;

mkdirSync(outDir, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** HTML renderizado da wiki → seções de texto puro. */
function toSections(html: string): WikiSection[] {
  const clean = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<span class="mw-editsection"[\s\S]*?<\/span>\s*<\/span>/gi, "");
  const parts = clean.split(/<h[23][^>]*>/i);
  const text = (s: string) =>
    s
      // Quebras do HTML cru não são do texto: sem isso, cada célula de tabela vira uma linha.
      .replace(/\s*\n\s*/g, " ")
      .replace(/<(br|\/p|\/li|\/tr|\/h\d)[^>]*>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " | ")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;|&#8201;|&#160;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;|&#039;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim();
  return parts
    .map((part, i) => {
      const end = part.search(/<\/h[23]>/i);
      const heading = i === 0 || end < 0 ? "Resumo" : text(part.slice(0, end));
      return { heading, text: text(i === 0 || end < 0 ? part : part.slice(end)) };
    })
    .filter((s) => s.text.length > 0 && !/^(Gallery|Navigation|Update history|References|External Links|3D models|Backstory|Trivia)$/i.test(s.heading));
}

async function fetchPage(title: string): Promise<WikiPage | null> {
  const url = `${API}?action=parse&page=${encodeURIComponent(title.replace(/ /g, "_"))}&prop=text|revid&redirects=1&format=json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "deadlock-builds-research/0.1" } });
    if (res.status === 429 || res.status >= 500) {
      await sleep(5000 * (attempt + 1));
      continue;
    }
    const json = (await res.json()) as { error?: { code: string }; parse?: { title: string; revid: number; text: { "*": string } } };
    if (json.error || !json.parse) return null;
    return {
      title: json.parse.title,
      url: `https://deadlock.wiki/${json.parse.title.replace(/ /g, "_")}`,
      revid: json.parse.revid,
      fetchedAt: new Date().toISOString(),
      sections: toSections(json.parse.text["*"]),
    };
  }
  return null;
}

const data = loadSnapshot();
const titles = [...data.items.map((i) => i.name), ...data.heroes.map((h) => h.name)];
let fetched = 0;
const missing: string[] = [];
for (const title of titles) {
  const file = join(outDir, `${title.replace(/[^\w-]+/g, "_")}.json`);
  if (!refresh && existsSync(file)) continue;
  const page = await fetchPage(title);
  if (page) {
    writeFileSync(file, JSON.stringify(page, null, 1));
    fetched++;
  } else missing.push(title);
  await sleep(DELAY_MS);
}
const cached = titles.length - fetched - missing.length;
console.log(`Wiki: ${fetched} páginas baixadas, ${cached} do cache, ${missing.length} sem página${missing.length ? `: ${missing.join(", ")}` : ""}.`);
