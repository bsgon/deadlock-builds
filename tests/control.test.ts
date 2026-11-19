import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { evaluateBuild } from "../src/engine/index.ts";
import { CONTROL_MIN_PER_MINUTE, controlSources, heroControl } from "../src/optimizer/control.ts";
import { computeMetrics, DEFAULT_METRIC_OPTIONS } from "../src/optimizer/metrics.ts";
import { optimize } from "../src/optimizer/optimize.ts";

const data = loadSnapshot();
const control = (hero: string, items: string[] = [], souls = 20000) =>
  computeMetrics(evaluateBuild(data, { hero, souls, items, abilityTiers: [1, 1, 1, 1], uptime: DEFAULT_METRIC_OPTIONS.uptime }), DEFAULT_METRIC_OPTIONS).control;

describe("métrica de controle", () => {
  it("heróis com stun no kit têm controle; Calico não", () => {
    expect(control("Abrams")).toBeGreaterThan(1);
    expect(control("Sinclair")).toBeGreaterThan(3);
    expect(control("Calico")).toBe(0);
  });

  it("durações com 'scale_function_tech_duration' crescem com itens de duração", () => {
    const hex = (items: string[]) =>
      evaluateBuild(data, { hero: "Sinclair", souls: 20000, items, uptime: 1 }).abilities.find((a) => a.name === "Rabbit Hex")!.properties.HexDuration!.value;
    expect(hex(["Superior Duration"])).toBeGreaterThan(hex([]));
  });

  it("ultimate ainda bloqueada não conta", () => {
    const early = evaluateBuild(data, { hero: "Abrams", souls: 500 });
    expect(controlSources(early, 0.5, 0.5).some((s) => s.name === "Seismic Impact")).toBe(false);
  });

  it("itens de controle aumentam a métrica; itens de duração aumentam o controle do kit", () => {
    const base = control("Haze");
    for (const item of ["Knockdown", "Disarming Hex", "Silence Wave", "Slowing Bullets", "Arctic Blast"]) {
      expect(control("Haze", [item]), item).toBeGreaterThan(base);
    }
    expect(control("Abrams", ["Superior Duration"])).toBeGreaterThan(control("Abrams"));
  });

  it("item que só reage a controle em você não conta como controle", () => {
    const b = evaluateBuild(data, { hero: "Haze", souls: 20000, items: ["Reactive Barrier", "Glass Cannon"] });
    expect(controlSources(b, 0.5, 0.5).filter((s) => s.from === "item")).toEqual([]);
  });

  it("slows se sobrepõem: o segundo vale menos que o primeiro sozinho", () => {
    const one = control("Haze", ["Slowing Bullets"]) - control("Haze");
    const two = control("Haze", ["Slowing Bullets", "Mystic Slow"]) - control("Haze", ["Mystic Slow"]);
    expect(two).toBeLessThan(one);
  });

  it("nenhum efeito passa de meio minuto de controle por minuto", () => {
    for (const hero of data.heroes) {
      const b = evaluateBuild(data, { hero: hero.name, souls: 40000, abilityTiers: [3, 3, 3, 3] });
      for (const s of controlSources(b, 0.5, 0.5)) expect(s.perMinute, `${hero.name}: ${s.name}`).toBeLessThanOrEqual(60 * 0.5 * 1.3 * 2);
    }
  });

  // Um teste por herói: cada otimização ocupa a CPU por vários segundos sem pausa.
  it.each(["Abrams", "Sinclair", "Graves"])("objetivo Controle (%s): mais controle que a Otimizada, mesma defesa mínima", (hero) => {
    {
      expect(heroControl(data, hero)).toBeGreaterThanOrEqual(CONTROL_MIN_PER_MINUTE);
      // Propriedade do modelo: sem o peso das partidas, que puxa as duas builds para os itens populares.
      const c = optimize(data, { hero, objective: "control", souls: 25000, matchWeight: 0 });
      const o = optimize(data, { hero, objective: "optimized", souls: 25000, matchWeight: 0 });
      // O objetivo Controle pesa as jogadas simuladas (alvo dentro da área, controle útil) acima
      // dos segundos somados, então a vantagem nessa métrica bruta é menor que antes (era 1,3x).
      expect(c.metrics.control, hero).toBeGreaterThan(o.metrics.control * 1.1);
      expect(c.metrics.ehp, hero).toBeGreaterThanOrEqual(c.weights.ehpFloor! * c.baseline.ehp * 0.95);
      expect(c.metrics.totalDps, hero).toBeGreaterThan(c.baseline.totalDps);
    }
  }, 120_000);

  it("heróis quase sem controle no kit ficam fora do objetivo", () => {
    expect(heroControl(data, "Calico")).toBeLessThan(CONTROL_MIN_PER_MINUTE);
    expect(heroControl(data, "Drifter")).toBeLessThan(CONTROL_MIN_PER_MINUTE);
  });
});
