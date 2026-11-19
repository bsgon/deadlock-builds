import { describe, expect, it } from "vitest";
import { loadSnapshot } from "../src/data/load.ts";
import { evaluateBuild, findItem } from "../src/engine/index.ts";
import { effectCatalog, type EffectDef } from "../src/combat/effects.ts";
import { reviewStatus } from "../src/combat/mechanics.ts";
import { simulate, type Action, type Scenario } from "../src/combat/sim.ts";
import { comboCycle, discoverInteractions, onHitActivations } from "../src/combat/interactions.ts";
import { analyzePurchase } from "../src/combat/explain.ts";
import { bestSequence, expectedValue, playActions, playReport, PLANS, scenarios } from "../src/combat/value.ts";
import { buildEffects } from "../src/combat/effects.ts";
import { optimize } from "../src/optimizer/optimize.ts";
import { validateRoute } from "../src/optimizer/route.ts";

const data = loadSnapshot();
const catalog = effectCatalog(data);
const of = (cls: string) => catalog.filter((e) => e.source.className === cls);
const CR = "ability_bookworm_aoemagic";
const VORTEX = "upgrade_aoe_root";
const BOOKWYRM = "ability_bookworm_dragonfire";
const cls = (name: string) => findItem(data, name).className;

/** Um inimigo atento, parado a 20 m, que sai da área e usa dash. */
const duel: Scenario = { id: "t", label: "teste", enemies: [{ x: 20, y: 0 }], behavior: "hold", reaction: 0.4, canDash: true, cleansers: 0, incomingDps: 0, incomingFor: 0, allyDps: 0, readyAt: 0 };
const act = (source: string, at: number): Action => ({ source, name: source, at, effects: of(source), aim: { x: 20, y: 0 } });
const run = (actions: Action[], scenario: Scenario = duel) => simulate(scenario, actions, { ehp: 5000, engaged: false });

describe("modelo de efeitos (patch do snapshot)", () => {
  it("Captivating Read: lentidão ao marcar; dano e imobilização na detonação 1,25 s depois", () => {
    const effects = of(CR);
    const slow = effects.find((e) => e.state === "slow")!;
    const imm = effects.find((e) => e.state === "immobilize")!;
    expect(slow.trigger).toBe("landing");
    expect(imm.trigger).toBe("resolve");
    expect(imm.timing.resolveDelay).toBe(1.25);
    expect(imm.geometry.radius).toBe(7.5);
    expect(imm.provenance.url).toContain("deadlock.wiki");
    // Imobilização não é stun: o alvo ainda pode dissipar.
    expect(imm.state).not.toBe("stun");
    expect(imm.counters).toContain("dispel");
  });

  it("Vortex Web: puxão para um ponto, imobilização curta, lentidão e silêncio de movimento", () => {
    const states = of(VORTEX).map((e) => e.state);
    expect(states).toEqual(expect.arrayContaining(["pull", "immobilize", "slow", "movementSilence"]));
    expect(of(VORTEX).find((e) => e.state === "pull")!.geometry.radius).toBe(12);
  });

  it("revisões conferem com o patch; mudar um valor de que dependem marca a revisão como desatualizada", () => {
    expect(reviewStatus(data).every((s) => !s.stale)).toBe(true);
    const changed = { ...data, abilities: data.abilities.map((a) => (a.className === CR ? { ...a, properties: { ...a.properties, Radius: { ...a.properties.Radius!, value: 9 } } } : a)) };
    const status = reviewStatus(changed).find((s) => s.review.source === CR)!;
    expect(status.stale).toBe(true);
    expect(status.changed[0]).toMatchObject({ key: "Radius", reviewed: 7.5, now: 9 });
  });

  it("campos sem fonte ficam marcados como desconhecidos", () => {
    expect(of(BOOKWYRM).some((e) => e.provenance.unknown.some((u) => u.includes("geometry.speed")))).toBe(true);
  });
});

describe("1. timing da Paige", () => {
  it("sem preparo o alvo sai da área antes da detonação; com o puxão sincronizado é atingido", () => {
    const alone = run([act(CR, 0)]);
    expect(alone.hits[CR] ?? 0).toBe(0);
    expect(alone.escaped[CR]).toBe(1);
    const vortexFirst = run([act(VORTEX, 0), act(CR, 0.25)]);
    expect(vortexFirst.hits[CR]).toBe(1);
    // Lançar Captivating Read ANTES do Vortex também funciona, se o puxão chega antes da detonação.
    const crFirst = run([act(CR, 0), act(VORTEX, 0.1)]);
    expect(crFirst.hits[CR]).toBe(1);
  });

  it("atrasar o puxão para depois da detonação elimina o ganho", () => {
    const late = run([act(CR, 0), act(VORTEX, 1.6)]);
    expect(late.hits[CR] ?? 0).toBe(0);
    expect(late.escaped[CR]).toBe(1);
  });

  it("aliado que já prende o alvo tira o ganho adicional do preparo", () => {
    const held = { ...duel, allyHold: { target: 0, until: 3, state: "stun" as const } };
    const alone = run([act(CR, 0)], held);
    const prepared = run([act(VORTEX, 0), act(CR, 0.25)], held);
    expect(alone.hits[CR]).toBe(1);
    expect(prepared.hits[CR]).toBe(alone.hits[CR]);
  });

  it("terceira ação: Bookwyrm sobre os alvos presos só credita o dano que cabe na janela", () => {
    const tf = scenarios(30000).teamfight;
    const aim = { x: 23.5, y: 0 };
    const two = simulate(tf, [VORTEX, CR].map((s, i) => ({ ...act(s, i * 0.25), aim })), { ehp: 5000, engaged: false });
    const three = simulate(tf, [{ ...act(VORTEX, 0), aim }, { ...act(CR, 0.25), aim }, { ...act(BOOKWYRM, 1.5), aim }], { ehp: 5000, engaged: false });
    const bookwyrmDps = of(BOOKWYRM).find((e) => e.state === "dot")!;
    const maxTrail = (bookwyrmDps.timing.duration + 1) * bookwyrmDps.magnitude * tf.enemies.length + 60 * tf.enemies.length;
    expect(three.damage).toBeGreaterThan(two.damage);
    expect(three.damage - two.damage).toBeLessThanOrEqual(maxTrail);
  });

  it("a busca de sequências acha Vortex → Captivating Read → Bookwyrm e compara com a habilidade sozinha", () => {
    const build = evaluateBuild(data, { hero: "Paige", souls: 30000, items: [cls("Vortex Web")], abilityTiers: [1, 1, 1, 0], uptime: 0.5 });
    const actions = playActions(buildEffects(build, 0));
    const { best } = bestSequence(actions, scenarios(30000).spread, 5000, PLANS.control);
    const sources = best!.steps.map((s) => s.source);
    expect(sources).toContain(VORTEX);
    expect(sources).toContain(CR);
    expect(sources.length).toBe(3);
    expect(sources.indexOf(VORTEX)).toBeLessThan(sources.indexOf(CR));
    const alone = bestSequence(actions.filter((a) => a.source !== VORTEX), scenarios(30000).spread, 5000, PLANS.control).best!;
    expect(Object.values(best!.sim.hits).reduce((a, b) => a + b, 0)).toBeGreaterThan(Object.values(alone.sim.hits).reduce((a, b) => a + b, 0));
  });
});

describe("2. atributos e sinergia", () => {
  const health = (items: string[]) => evaluateBuild(data, { hero: "Paige", souls: 30000, items, abilityTiers: [1, 1, 1, 0] }).stats.health;

  it("dois itens de vida somam o valor básico de cada um (o degrau de investimento em vitality é à parte)", () => {
    const base = health([]);
    // Vida fixa dos itens = vida total − vida base com o bônus de investimento em vitality.
    const flat = (items: string[]) => {
      const b = evaluateBuild(data, { hero: "Paige", souls: 30000, items, abilityTiers: [1, 1, 1, 0] });
      return b.stats.health - base * (1 + b.spending.bonus.vitality / 100);
    };
    expect(flat(["Extra Health", "Debuff Reducer"])).toBeCloseTo(flat(["Extra Health"]) + flat(["Debuff Reducer"]), 5);
    // Sem interação com o kit, a soma não vira "sinergia": as jogadas não mudam fora de ameaça.
    const u = (items: string[]) => playReport(evaluateBuild(data, { hero: "Paige", souls: 30000, items: items.map(cls), abilityTiers: [1, 1, 1, 0], uptime: 0.5 }), "control", { only: ["teamfight"] }).utility;
    expect(u(["Extra Health", "Debuff Reducer"])).toBeCloseTo(u([]), 5);
  });

  it("quando a vida a mais permite concluir a jogada, o ganho extra aparece como execução", () => {
    // Iniciação forte: sem a vida extra a Paige morre antes de lançar.
    const ctx = { hero: "Paige", souls: 20000, abilityTiers: [1, 1, 1, 0], plan: "control" as const, fights: ["dive" as const], scenario: { incomingDps: 2200, incomingFor: 2.5 } };
    const before: string[] = [];
    const after = [cls("Fortitude")];
    const r = analyzePurchase(data, ctx, before, after, findItem(data, "Fortitude"));
    expect(r.deltaU).toBeGreaterThan(0);
    expect(r.parts[0]!.family).toBe("defenseExposure");
    expect(r.family).toBe("defenseExposure");
    // Sem ameaça, a mesma vida não muda as jogadas.
    const calm = analyzePurchase(data, { ...ctx, fights: ["teamfight"], scenario: undefined }, before, after, findItem(data, "Fortitude"));
    expect(calm.deltaU).toBeCloseTo(0, 5);
  });

  it("conta aritmética (dados fictícios): acerto vale mais que dano quando o acerto é baixo", () => {
    expect(expectedValue(1000, 0.4)).toBe(400);
    expect(expectedValue(1100, 0.4)).toBeCloseTo(440);
    expect(expectedValue(1000, 0.7)).toBe(700);
  });
});

describe("3. limites e sobreposição", () => {
  it("efeito por acerto respeita o cooldown interno", () => {
    const mystic = catalog.find((e) => e.source.className === cls("Mystic Shot") && e.state === "damage")!;
    const icd = Math.max(mystic.rules.internalCooldown ?? 0, mystic.timing.cooldown);
    expect(icd).toBeGreaterThanOrEqual(8);
    const n = onHitActivations({ hitsPerSecond: 10, fightSeconds: 20, internalCooldown: icd });
    expect(n).toBe(3); // 200 acertos, mas só 3 ativações em 20 s
    expect(onHitActivations({ hitsPerSecond: 10, fightSeconds: 20, internalCooldown: 0.2, cap: 12 })).toBe(12);
  });

  it("terceiro controle sobreposto só recebe crédito pelo tempo a mais", () => {
    const stun = (id: string, duration: number): EffectDef => ({
      ...of(CR).find((e) => e.state === "immobilize")!,
      id: `${id}:stun`,
      source: { kind: "item", className: id, name: id },
      state: "stun",
      trigger: "landing",
      origin: "target",
      target: "enemy",
      geometry: { range: 30, radius: null, speed: null, los: null },
      timing: { castDelay: 0, resolveDelay: 0, duration, tickInterval: null, charges: 1, cooldown: 30 },
      counters: [],
    });
    const s = (id: string, at: number, d: number): Action => ({ source: id, name: id, at, effects: [stun(id, d)] });
    const two = run([s("a", 0, 1), s("b", 0.5, 1)]);
    const inside = run([s("a", 0, 1), s("b", 0.5, 1), s("c", 0.6, 0.5)]);
    const longer = run([s("a", 0, 1), s("b", 0.5, 1), s("c", 1, 1)]);
    expect(inside.control).toBeCloseTo(two.control, 5);
    expect(longer.control - two.control).toBeCloseTo(0.5, 1);
  });

  it("redução de cooldown: o combo volta quando a peça mais lenta volta", () => {
    const pieces = [
      { cooldown: 30, kind: "ability" as const },
      { cooldown: 42, kind: "item" as const },
    ];
    expect(comboCycle(pieces, { ability: 0, item: 0 })).toEqual({ cycle: 42, limiter: 1 });
    // Cooldown de habilidade não acelera o item: o combo continua preso nos 42 s.
    expect(comboCycle(pieces, { ability: 20, item: 0 }).cycle).toBe(42);
    expect(comboCycle(pieces, { ability: 0, item: 30 }).cycle).toBe(30);
  });
});

describe("4. generalização", () => {
  const kit = (hero: string) => {
    const h = data.heroes.find((x) => x.name === hero)!;
    const own = data.abilities.filter((a) => a.heroId === h.id).map((a) => a.className);
    return catalog.filter((e) => own.includes(e.source.className));
  };

  it("Infernus: restrição + detonação atrasada (Concussive Combustion) com as mesmas regras", () => {
    const found = discoverInteractions([...kit("Infernus"), ...of(cls("Knockdown")), ...of(VORTEX)]);
    expect(found.some((c) => c.family === "restraintDelayed" && c.payoff.source.className === "ability_fire_bomb")).toBe(true);
    const build = (items: string[]) => evaluateBuild(data, { hero: "Infernus", souls: 35000, items, abilityTiers: [1, 1, 1, 1], uptime: 0.5 });
    const u = (items: string[]) => playReport(build(items), "control", { only: ["skirmish", "spread"] }).utility;
    expect(u([cls("Vortex Web")])).toBeGreaterThan(u([]));
  });

  it("Haze: acertos frequentes + efeito por acerto, e dano que acorda o alvo do sono (efeito negativo)", () => {
    const found = discoverInteractions([...kit("Haze"), ...of(cls("Mystic Shot"))]);
    expect(found.some((c) => c.family === "onHit")).toBe(true);
    const dagger = kit("Haze").filter((e) => e.source.className === "ability_sleep_dagger");
    expect(dagger.find((e) => e.state === "sleep")!.rules.breaksOnDamage).toBe(true);
    const sleep: Action = { source: "ability_sleep_dagger", name: "Sleep Dagger", at: 0, effects: dagger };
    const quiet = run([sleep]);
    const hit = run([sleep], { ...duel, allyDps: 50 });
    expect(hit.enemies[0]!.control).toBeLessThan(quiet.enemies[0]!.control);
  });

  it("compra defensiva passa à frente da ofensiva quando a Paige não sobrevive à iniciação", () => {
    const ctx = { hero: "Paige", souls: 20000, abilityTiers: [1, 1, 1, 0], plan: "control" as const, fights: ["dive" as const], scenario: { incomingDps: 2200, incomingFor: 2.5 } };
    const before: string[] = [];
    const defensive = analyzePurchase(data, ctx, before, [cls("Fortitude")], findItem(data, "Fortitude"), { item: findItem(data, "Superior Cooldown"), after: [cls("Superior Cooldown")] });
    expect(defensive.alternative!.deltaU).toBeLessThan(defensive.deltaU);
    expect(defensive.family).toBe("defenseExposure");
  });
});

describe("5. compra e dados incompletos", () => {
  it("cada etapa da rota cabe no orçamento e no inventário; upgrade consome o componente", () => {
    const r = optimize(data, { hero: "Paige", objective: "control", souls: 25000 });
    expect(validateRoute(data, r, 9)).toEqual([]);
    const upgrade = r.order.find((s) => s.upgradeFrom);
    if (upgrade) {
      const i = r.order.indexOf(upgrade);
      expect(r.order.slice(0, i).some((s) => s.item === upgrade.upgradeFrom)).toBe(true);
    }
  }, 120_000);

  it("rota adulterada é recusada", () => {
    const r = optimize(data, { hero: "Paige", objective: "control", souls: 15000 });
    const broken = { ...r, order: r.order.map((s, i) => (i === 1 ? { ...s, earned: 0 } : s)) };
    expect(validateRoute(data, broken, 9).length).toBeGreaterThan(0);
  }, 120_000);

  it("sem estatísticas a recomendação sai como mecânica, com a incerteza explícita", () => {
    const bare = { ...data, stats: undefined, windows: undefined };
    const ctx = { hero: "Paige", souls: 30000, abilityTiers: [1, 1, 1, 0], plan: "control" as const };
    const r = analyzePurchase(bare, ctx, [cls("Slowing Hex")], [cls("Vortex Web")], findItem(data, "Vortex Web"));
    expect(r.kind).toBe("mecânica");
    expect(r.observed).toBeNull();
    expect(r.uncertainty.some((u) => u.includes("cenário assumido"))).toBe(true);
    expect(r.confidenceBest).not.toBe("alta");
    // O ganho do Vortex vem principalmente de reposicionar os alvos (repetição sem o puxão).
    expect(r.parts[0]!.label).toContain("puxão");
    expect(r.family).toBe("grouping");
    expect(r.text).toContain("Use Vortex Web");
  });

  it("explicação de compra na ordem do otimizador (alternativa, jogada, confiança)", () => {
    const r = optimize(data, { hero: "Paige", objective: "control", souls: 12000, explain: true });
    const explained = r.order.filter((s) => s.why);
    expect(explained.length).toBe(r.order.length);
    for (const s of explained) {
      expect(["alta", "média", "baixa"]).toContain(s.why!.confidenceWorks);
      expect(["alta", "média", "baixa"]).toContain(s.why!.confidenceBest);
    }
  }, 120_000);
});
