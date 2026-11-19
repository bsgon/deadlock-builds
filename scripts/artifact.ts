/**
 * Empacota o app web numa página única e autocontida (é o que o GitHub Pages publica).
 *
 *   npm run artifact
 *
 * A página não carrega imagens nem dados de outros hosts, então este
 * script baixa os ícones do CDN do deadlock-api.com (com cache em data/raw/img),
 * embute cada um como data URI no snapshot, embute o snapshot na página e
 * junta o JS e o CSS do build do Vite. Saída: dist-artifact/index.html.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSnapshot } from "../src/data/load.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const imgCache = join(root, "data", "raw", "img");
const outDir = join(root, "dist-artifact");
const CDN = "https://assets-bucket.deadlock-api.com/";
const MAX_IMAGE_BYTES = 512 * 1024;
const CONCURRENCY = 6;

// 1. Build do app com o Vite.
execFileSync(process.execPath, [join(root, "node_modules", "vite", "bin", "vite.js"), "build"], { stdio: "inherit", cwd: root });
// Os arquivos certos são os que o index.html do build referencia (dist/assets pode ter sobras de builds antigos).
const builtHtml = await readFile(join(root, "dist", "index.html"), "utf8");
const jsPath = /<script[^>]+src="\.?\/?(assets\/[^"]+\.js)"/.exec(builtHtml)?.[1];
const cssPath = /<link[^>]+href="\.?\/?(assets\/[^"]+\.css)"/.exec(builtHtml)?.[1];
if (!jsPath || !cssPath) throw new Error("Não achei o JS e o CSS referenciados em dist/index.html.");
const js = await readFile(join(root, "dist", jsPath), "utf8");
const css = await readFile(join(root, "dist", cssPath), "utf8");

// 2. Ícones: baixa (com cache) e converte em data URI.
const data = loadSnapshot();
const urls = new Set<string>();
for (const list of [data.heroes, data.items, data.abilities]) for (const x of list) if (x.image) urls.add(x.image);

await mkdir(imgCache, { recursive: true });
const dataUris = new Map<string, string>();
let failed = 0;
let bytes = 0;

async function fetchImage(url: string): Promise<void> {
  if (!url.startsWith(CDN)) return; // só o CDN conhecido
  const file = join(imgCache, url.slice(CDN.length).replace(/[^a-zA-Z0-9._-]/g, "_"));
  let body: Buffer;
  if (existsSync(file)) {
    body = await readFile(file);
  } else {
    const res = await fetch(url);
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) {
      failed++;
      return;
    }
    body = Buffer.from(await res.arrayBuffer());
    await writeFile(file, body);
  }
  if (body.length > MAX_IMAGE_BYTES) {
    failed++;
    return;
  }
  const ext = basename(url).split(".").pop()?.toLowerCase();
  const mime = ext === "webp" ? "image/webp" : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : null;
  if (!mime) {
    failed++;
    return;
  }
  bytes += body.length;
  dataUris.set(url, `data:${mime};base64,${body.toString("base64")}`);
}

const queue = [...urls];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    for (let url = queue.shift(); url; url = queue.shift()) await fetchImage(url);
  }),
);
console.log(`Ícones: ${dataUris.size} de ${urls.size} (${(bytes / 1024 / 1024).toFixed(2)} MB)${failed ? `, ${failed} falharam e vão aparecer como iniciais` : ""}`);

const swap = <T extends { image: string | null }>(list: T[]): T[] => list.map((x) => ({ ...x, image: x.image ? (dataUris.get(x.image) ?? null) : null }));
const embedded = { ...data, heroes: swap(data.heroes), items: swap(data.items), abilities: swap(data.abilities) };

// 3. Página: o artefato envolve o conteúdo no esqueleto HTML, então não há <html>, <head> nem <body>.
// "<" vira < para nenhum texto dos dados fechar a tag <script> antes da hora.
// Todo caractere fora do ASCII vira escape, então a página funciona com qualquer codificação declarada.
const jsEscape = (text: string) => text.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
const cssEscape = (text: string) => text.replace(/[\u0080-￿]/g, (c) => `\\${c.charCodeAt(0).toString(16)} `);
const safe = (text: string) => jsEscape(text.replace(/</g, "\\u003c"));
if (/<\/script/i.test(js)) throw new Error("O bundle contém '</script' e quebraria a página embutida.");
const page = `<title>Livro de Souls</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800&family=Atkinson+Hyperlegible+Next:wght@400;600&display=swap" rel="stylesheet" />
<style>
${cssEscape(css)}
</style>
<div id="app"><p class="loading">Carregando dados do jogo&hellip;</p></div>
<script type="application/json" id="snapshot">${safe(JSON.stringify(embedded))}</script>
<script type="module">
${jsEscape(js)}
</script>
`;
if (/[^\x00-\x7f]/.test(page)) throw new Error("A página ainda tem caracteres fora do ASCII.");

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "index.html"), page);
console.log(`Gravado dist-artifact/index.html (${(Buffer.byteLength(page) / 1024 / 1024).toFixed(2)} MB, patch ${data.meta.clientVersion})`);
