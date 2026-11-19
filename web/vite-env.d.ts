// Importação de worker do Vite: "./arquivo.ts?worker&inline" devolve o construtor do Worker,
// com o código embutido no bundle (Blob URL), sem arquivo separado.
declare module "*?worker&inline" {
  const WorkerConstructor: new (options?: { name?: string }) => Worker;
  export default WorkerConstructor;
}
