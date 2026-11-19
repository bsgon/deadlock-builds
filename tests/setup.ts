import { beforeEach } from "vitest";

// Os testes do otimizador são longos e síncronos. Sem uma volta pelo laço de eventos entre
// eles, a resposta do processo principal a "onTaskUpdate" fica na fila por mais de 60 s
// somando vários testes seguidos, e o Vitest acusa "Timeout calling onTaskUpdate".
beforeEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
