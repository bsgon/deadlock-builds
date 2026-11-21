/**
 * Web Worker da otimização: tira o cálculo da thread principal para a página
 * não congelar. Recebe os dados do jogo uma vez (como texto JSON, que copia
 * rápido) e depois um pedido por configuração; cada resposta leva o id do pedido.
 */
import type { GameData } from "../src/data/types.ts";
import type { OptimizeInput } from "../src/optimizer/optimize.ts";
import { applyFightProfile } from "../src/optimizer/metrics.ts";
import { setLang, tr, type Lang } from "../src/i18n.ts";
import { computeBuild, type BuildPayload } from "./compute.ts";

export type WorkerRequest = { type: "data"; json: string; lang: Lang } | { type: "compute"; id: number; input: OptimizeInput };
export type WorkerResponse = { id: number; ok: true; payload: BuildPayload } | { id: number; ok: false; message: string };

// O projeto não carrega a lib "WebWorker" do TypeScript; só o necessário do escopo do worker.
const scope = self as unknown as {
  onmessage: ((ev: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

let data: GameData | null = null;

scope.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "data") {
    data = JSON.parse(msg.json) as GameData;
    // Estado global do módulo de métricas: precisa ser aplicado também deste lado.
    applyFightProfile(data.fights);
    // O idioma também é estado global: os textos das explicações saem do worker.
    setLang(msg.lang, data.translations);
    return;
  }
  try {
    if (!data) throw new Error(tr("O worker recebeu um pedido antes dos dados do jogo.", "The worker got a request before the game data."));
    scope.postMessage({ id: msg.id, ok: true, payload: computeBuild(data, msg.input) });
  } catch (err) {
    scope.postMessage({ id: msg.id, ok: false, message: (err as Error).message ?? String(err) });
  }
};
