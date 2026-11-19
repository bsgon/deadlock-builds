/**
 * Imprime os números de uma build para conferir com o jogo.
 *
 *   npm run report                                   três builds de exemplo
 *   npm run report -- "Haze" 6400 "Extra Spirit" ...  herói, souls e itens
 */
import { loadSnapshot } from "../src/data/load.ts";
import { evaluateBuild, type BuildInput } from "../src/engine/index.ts";

const data = loadSnapshot();
const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d).replace(/\.0+$/, "") : "∞");

function print(input: BuildInput): void {
  const r = evaluateBuild(data, input);
  const s = r.stats;
  console.log(`\n=== ${r.hero.name} | ${input.souls} souls | nível ${r.progression.level} (${r.progression.boons} boons) ===`);
  console.log(`Itens (${r.spending.total} souls): ${r.items.map((i) => i.name).join(", ") || "nenhum"}`);
  console.log(
    `Investimento: weapon ${r.spending.bySlot.weapon} (+${r.spending.bonus.weapon}% dano), ` +
      `vitality ${r.spending.bySlot.vitality} (+${r.spending.bonus.vitality}% vida base), ` +
      `spirit ${r.spending.bySlot.spirit} (+${r.spending.bonus.spirit} spirit)`,
  );
  console.log(`Arma: ${f(s.bulletDamage, 2)} x${s.bulletsPerShot} por tiro, ${f(s.shotsPerSecond, 2)} tiros/s, pente ${s.clipSize}, recarga ${f(s.reloadTime, 2)}s`);
  console.log(`      DPS ${f(s.burstDps)} (com recarga ${f(s.sustainedDps)}), dano de arma +${f(s.weaponDamagePct)}%, cadência +${f(s.fireRatePct)}%`);
  console.log(`Spirit Power: ${f(s.spiritPower)} | cooldown -${f(s.cooldownReductionPct)}% | duração +${f(s.durationPct)}% | alcance +${f(s.rangePct)}%`);
  console.log(`Vida: ${f(s.health, 0)} | resist bala ${f(s.bulletResist)}% (EHP ${f(s.ehpBullet, 0)}) | resist spirit ${f(s.spiritResist)}% (EHP ${f(s.ehpSpirit, 0)})`);
  for (const a of r.abilities) {
    const parts = Object.entries(a.properties)
      .filter(([, p]) => p.label && p.value !== 0 && (p.coef !== null || /Cooldown$|Charges$/.test(p.label)))
      .map(([, p]) => `${p.label} ${f(p.value)}${p.unit}`);
    console.log(`  [${a.slot}] ${a.name} T${a.tier}: ${parts.join(", ")}`);
  }
  for (const w of r.warnings) console.log(`  AVISO: ${w}`);
}

const [hero, souls, ...items] = process.argv.slice(2);
if (hero && souls) {
  print({ hero, souls: Number(souls), items });
} else {
  print({ hero: "Infernus", souls: 0 });
  print({ hero: "Haze", souls: 8000, items: ["Headshot Booster", "Extra Spirit", "Mystic Shot", "Extra Health"], abilityTiers: [1, 0, 1, 0] });
  print({ hero: "Abrams", souls: 12000, items: ["Extra Health", "Improved Spirit", "Spirit Lifesteal", "Bullet Resist Shredder"], abilityTiers: [2, 1, 1, 0] });
}
