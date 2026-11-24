/**
 * Conteúdo do mouse-over de itens e habilidades, só com dados (sem DOM), para poder
 * ser testado. Os nomes de atributos e as descrições vêm do jogo, em inglês.
 */
import type { Ability, GameData, Item, Property, PropertyUpgrade } from "../src/data/types.ts";
import { locale, tr } from "../src/i18n.ts";
import { badgeName, heroElite } from "../src/meta/elite.ts";
import { heroMeta } from "../src/meta/stats.ts";

export interface TipSection {
  title?: string;
  text?: string;
  /** Pares nome e valor. */
  stats?: [string, string][];
}

export interface TipContent {
  title: string;
  meta?: string;
  sections: TipSection[];
  footer?: string;
}

const num = (n: number) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 3 }).format(Math.abs(n));
const signed = (n: number) => `${n < 0 ? "−" : "+"}${num(n)}`;
const unitOf = (unit: string) => (!unit || unit === "%" || unit === "°" || unit.startsWith("/") ? unit : ` ${unit}`);
/** Nome da propriedade sem rótulo na API: "TechResistDebuff" → "Tech Resist Debuff". */
const humanize = (name: string) => name.replace(/([a-z])([A-Z])/g, "$1 $2");

const SCALING_STAT: Record<string, string> = { ETechPower: "Spirit", EWeaponPower: "Weapon", ETechRange: "Range" };

const unique = (lines: [string, string][]) => [...new Map(lines.map((l) => [l.join("|"), l])).values()];

/** Propriedades com rótulo e valor, sem linhas repetidas. */
function statLines(properties: Record<string, Property>, names: string[], plus: boolean): [string, string][] {
  return unique(
    names.flatMap((name): [string, string][] => {
      const p = properties[name];
      if (!p?.label || !p.value) return [];
      return [[p.label, `${plus || p.value < 0 ? signed(p.value) : num(p.value)}${unitOf(p.unit)}`]];
    }),
  );
}

/** "Comprado em 63% das partidas de Infernus (Ascendant 1+: 70%)"; vazio sem estatísticas do herói. */
export function pickText(data: GameData, heroId: number | null, item: Item): string {
  if (heroId === null) return "";
  const hero = data.heroes.find((h) => h.id === heroId)?.name ?? "";
  const percent = (x: number) => (x > 0 && x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`);
  const meta = heroMeta(data, heroId);
  const elite = heroElite(data, heroId);
  const high = elite && elite.matches > 0 ? `${badgeName(elite.badge)}+: ${percent((elite.items[item.className]?.matches ?? 0) / elite.matches)}` : "";
  if (!meta || meta.matches <= 0) return high;
  const rate = percent((meta.items[item.className]?.matches ?? 0) / meta.matches);
  return tr(`Comprado em ${rate} das partidas de ${hero}`, `Bought in ${rate} of ${hero} matches`) + (high ? ` (${high})` : "");
}

export function itemTip(data: GameData, heroId: number | null, item: Item): TipContent {
  const slot = { weapon: tr("Arma", "Weapon"), vitality: tr("Vitalidade", "Vitality"), spirit: "Spirit" }[item.slot];
  const components = item.components.map((c) => data.items.find((i) => i.className === c)?.name).filter((n) => n !== undefined);
  const sections = item.sections
    .map((s): TipSection => {
      const innate = s.type === "innate";
      const stats = statLines(item.properties, [...new Set([...s.important, ...s.properties])], innate);
      return {
        ...(innate ? {} : { title: s.type === "active" ? tr("Ativo", "Active") : tr("Passivo", "Passive") }),
        ...(s.text ? { text: s.text } : {}),
        ...(stats.length ? { stats } : {}),
      };
    })
    .filter((s) => s.text || s.stats);
  const pick = pickText(data, heroId, item);
  return {
    title: item.name,
    meta:
      `${slot}, tier ${item.tier}, ${item.cost.toLocaleString(locale())} souls` +
      (components.length ? tr(`, melhora ${components.join(", ")}`, `, upgrades ${components.join(", ")}`) : ""),
    sections: sections.length || !item.text ? sections : [{ text: item.text }],
    ...(pick ? { footer: pick } : {}),
  };
}

function upgradeLine(ability: Ability, u: PropertyUpgrade): [string, string][] {
  if (!u.bonus) return []; // a API traz upgrades neutros; não há o que mostrar
  const p = ability.properties[u.property];
  const label = p?.label ?? humanize(u.property);
  const stat = (u.statFilter && SCALING_STAT[u.statFilter]) || tr("escala", "scaling");
  switch (u.type) {
    case "addBase":
      return [[label, `${signed(u.bonus)}${unitOf(p?.unit ?? "")}`]];
    case "addScale":
      return [[label, `${signed(u.bonus)} × ${stat}`]];
    case "mulBase":
      // Porcentagem somada à base; mulScale é fator.
      return [[label, `${signed(u.bonus)}%`]];
    case "mulScale":
      return [[label, `${stat} ×${num(u.bonus)}`]];
  }
}

/** Propriedades base mostradas em toda habilidade, na ordem. */
function baseNames(ability: Ability): string[] {
  const charges = ability.properties.AbilityCharges?.value ?? 0;
  const names = charges > 1 ? ["AbilityCooldown", "AbilityCharges", "AbilityCooldownBetweenCharge"] : ["AbilityCooldown"];
  return [...names, "AbilityDuration", "AbilityCastRange"].filter((n) => (ability.properties[n]?.value ?? 0) > 0);
}

export function abilityTip(ability: Ability): TipContent {
  const stats = statLines(ability.properties, baseNames(ability), false);
  const upgrades = ability.upgrades.map((tier, i): TipSection => ({ title: `Upgrade ${i + 1}`, stats: unique(tier.flatMap((u) => upgradeLine(ability, u))) }));
  return {
    title: ability.name,
    meta: ability.slot === 4 ? tr("Habilidade 4, ultimate", "Ability 4, ultimate") : tr(`Habilidade ${ability.slot}`, `Ability ${ability.slot}`),
    sections: [{ ...(ability.text ? { text: ability.text } : {}), stats }, ...upgrades].filter((s) => s.text || s.stats?.length),
  };
}
