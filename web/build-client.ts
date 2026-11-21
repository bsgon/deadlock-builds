/**
 * Ponte entre a interface e o worker da otimização.
 *
 * - Um pedido por vez: se a configuração muda no meio de um cálculo, o worker é
 *   encerrado e recriado (o cálculo não tem pontos de pausa, então não dá para
 *   interromper de outro jeito); nada fica enfileirado.
 * - Cada pedido tem um id; resposta com id diferente do pedido atual é descartada.
 * - Cache em memória por configuração (chave = JSON com chaves ordenadas), para
 *   voltar a uma configuração já vista sem recalcular.
 * - Se o navegador não deixar criar o worker (CSP da página, por exemplo), calcula
 *   na thread principal depois de pintar o estado "calculando".
 */
import type { GameData } from "../src/data/types.ts";
import { lang } from "../src/i18n.ts";
import type { OptimizeInput } from "../src/optimizer/optimize.ts";
import { computeBuild, relinkItems, withoutImages, type BuildPayload } from "./compute.ts";
import type { WorkerRequest, WorkerResponse } from "./optimize.worker.ts";
// "inline": o código do worker vai dentro do bundle principal (a página publicada é um arquivo só).
import OptimizeWorker from "./optimize.worker.ts?worker&inline";

export type BuildOutcome = { ok: true; payload: BuildPayload } | { ok: false; message: string };

/** Configurações guardadas no cache (as mais antigas saem primeiro). */
const CACHE_LIMIT = 48;

/** Chave estável da configuração: a ordem das propriedades não importa. */
export function inputKey(input: OptimizeInput): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sorted((v as Record<string, unknown>)[k])]),
          )
        : v;
  return JSON.stringify(sorted(input));
}

interface Pending {
  id: number;
  key: string;
  input: OptimizeInput;
  onDone: (key: string) => void;
}

export class BuildClient {
  private readonly cache = new Map<string, BuildOutcome>();
  private worker: Worker | null = null;
  private useWorker = true;
  private nextId = 1;
  private pending: Pending | null = null;
  private dataJson: string | null = null;
  private readonly data: GameData;

  constructor(data: GameData) {
    this.data = data;
    // Cria o worker já na abertura: ele lê os dados enquanto a página desenha.
    this.ensureWorker();
  }

  /** Resultado guardado da configuração, se já foi calculado. */
  cached(key: string): BuildOutcome | undefined {
    const hit = this.cache.get(key);
    if (hit) {
      // Mais recente no fim (LRU).
      this.cache.delete(key);
      this.cache.set(key, hit);
    }
    return hit;
  }

  /**
   * Pede o cálculo da configuração. `onDone` é chamado com a chave quando o
   * resultado (ou o erro) entra no cache. Um pedido diferente em andamento é cancelado.
   */
  request(key: string, input: OptimizeInput, onDone: (key: string) => void): void {
    if (this.cache.has(key)) {
      onDone(key);
      return;
    }
    if (this.pending?.key === key) {
      this.pending.onDone = onDone;
      return;
    }
    this.cancel();
    const pending: Pending = { id: this.nextId++, key, input, onDone };
    this.pending = pending;
    const worker = this.useWorker ? this.ensureWorker() : null;
    if (worker) worker.postMessage({ type: "compute", id: pending.id, input } satisfies WorkerRequest);
    else this.computeHere(pending);
  }

  /** Cancela o cálculo em andamento se for de outra configuração. */
  cancelUnless(key: string): void {
    if (this.pending && this.pending.key !== key) this.cancel();
  }

  private cancel(): void {
    if (!this.pending) return;
    this.pending = null;
    // O worker está ocupado com um cálculo que ninguém mais quer: encerra e recria no próximo pedido.
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }

  private finish(id: number, outcome: BuildOutcome): void {
    const pending = this.pending;
    if (!pending || pending.id !== id) return; // resposta de um pedido antigo
    this.pending = null;
    this.cache.set(pending.key, outcome);
    if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
    pending.onDone(pending.key);
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (!this.useWorker) return null;
    let worker: Worker;
    try {
      worker = new OptimizeWorker();
    } catch {
      this.useWorker = false;
      return null;
    }
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const res = ev.data;
      // Os itens chegam como cópias sem ícone: troca pelos itens da página.
      this.finish(res.id, res.ok ? { ok: true, payload: relinkItems(res.payload, this.data.items) } : { ok: false, message: res.message });
    };
    worker.onerror = (ev) => {
      // Erros do cálculo voltam como mensagem; um evento de erro é o worker que não
      // carregou (ou morreu). Daqui em diante, calcula na thread principal.
      ev.preventDefault();
      console.warn("Worker da otimização indisponível; calculando na thread principal.", ev.message);
      this.useWorker = false;
      worker.terminate();
      if (this.worker === worker) this.worker = null;
      if (this.pending) this.computeHere(this.pending);
    };
    // Os dados vão como texto (cópia rápida); sem ícones, que o worker não usa.
    this.dataJson ??= JSON.stringify(withoutImages(this.data));
    worker.postMessage({ type: "data", json: this.dataJson, lang: lang() } satisfies WorkerRequest);
    this.worker = worker;
    return worker;
  }

  /** Plano B sem worker: espera a página pintar o "calculando" e calcula aqui (congela durante o cálculo). */
  private computeHere(pending: Pending): void {
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (this.pending !== pending) return;
        let outcome: BuildOutcome;
        try {
          outcome = { ok: true, payload: computeBuild(this.data, pending.input) };
        } catch (err) {
          outcome = { ok: false, message: (err as Error).message ?? String(err) };
        }
        this.finish(pending.id, outcome);
      }, 0),
    );
  }
}
