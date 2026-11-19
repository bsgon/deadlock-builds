/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// O snapshot normalizado é servido como arquivos estáticos (heroes.json, items.json...).
export default defineConfig({
  publicDir: "data/snapshot",
  base: "./",
  server: { port: 5173, strictPort: true },
  build: { outDir: "dist", target: "es2022" },
  // Os testes do otimizador ocupam a CPU por dezenas de segundos sem pausa; tests/setup.ts
  // devolve o controle ao laço de eventos antes de cada teste (ver o comentário lá).
  test: { setupFiles: ["tests/setup.ts"] },
});
