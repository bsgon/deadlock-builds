/**
 * Combos entre um item T4 e itens T3/T2: o que um efeito faz pelo outro numa luta
 * (agrupar e depois queimar, silenciar e depois causar dano), e não só atributos em comum.
 *
 * É uma análise feita à mão a partir dos textos e propriedades dos itens
 * (data/snapshot/items.json). Componentes do próprio T4 ficam de fora: somem na compra.
 * Também ficam de fora pares que os jogadores evitam nas partidas (menos de 0,8× o esperado),
 * por mais que o texto pareça combinar.
 *
 * Depois de um patch, tests/item-combos.test.ts acusa item que saiu da loja, mudou de tier
 * ou T4 novo sem análise; mudança de efeito com o mesmo nome precisa de revisão.
 */
import type { GameData, Item } from "../data/types.ts";
import { tr } from "../i18n.ts";

/**
 * Papel do T2/T3 em relação ao T4:
 * setup = vem antes e abre espaço; payoff = vem depois e aproveita; trigger = um aciona o
 * efeito do outro; amplify = aumenta o efeito; cover = cobre a fraqueza.
 */
export type ComboKind = "setup" | "payoff" | "trigger" | "amplify" | "cover";

export interface ItemCombo {
  t4: string;
  partner: string;
  kind: ComboKind;
  /** 1 = ajuda; 2 = forte; 3 = combo principal do item. */
  strength: 1 | 2 | 3;
  pt: string;
  en: string;
}

type Row = [partner: string, kind: ComboKind, strength: 1 | 2 | 3, pt: string, en: string];

const ROWS: Record<string, Row[]> = {
  // ---------------------------------------------------------------- Spirit
  "Arctic Blast": [
    ["Alchemical Fire", "payoff", 3, "O alvo congelado e depois lento não sai da poça: o fogo acerta a duração inteira e tira Bullet Resist.", "A frozen, then slowed target can't leave the pool: the fire hits for its full duration and strips Bullet Resist."],
    ["Warp Stone", "setup", 3, "A explosão sai de você: o teleporte coloca você no meio do grupo antes de congelar.", "The blast starts at you: the teleport puts you inside the group before freezing."],
    ["Greater Expansion", "amplify", 2, "O raio final de 16 m escala com alcance: congela mais gente e permite usar de mais longe.", "The 16m end radius scales with range: it freezes more people from farther out."],
    ["Spirit Snatch", "payoff", 2, "O congelamento de 1 s garante o Heavy Melee, que rouba Spirit Resist e Spirit Power.", "The 1s freeze guarantees the Heavy Melee that steals Spirit Resist and Spirit Power."],
    ["Shadow Weave", "setup", 2, "Chegar invisível resolve a aproximação; a explosão abre a emboscada com Spirit Power extra.", "Arriving in stealth solves the approach; the blast opens the ambush with bonus Spirit Power."],
    ["Silence Wave", "payoff", 1, "Depois do congelamento, o silêncio impede que o alvo lento use habilidade para escapar.", "After the freeze, the silence stops the slowed target from escaping with an ability."],
  ],
  "Boundless Spirit": [
    ["Torment Pulse", "amplify", 2, "Pulso constante que escala com Spirit Power: cada ponto extra rende em todos os pulsos.", "A constant pulse that scales with Spirit Power: every extra point pays off on every pulse."],
    ["Rapid Recharge", "amplify", 2, "Mais cargas são mais usos do mesmo Spirit Power alto dentro da luta.", "More charges mean more uses of the same high Spirit Power within a fight."],
    ["Superior Cooldown", "amplify", 2, "Spirit Power aumenta cada uso; a recarga menor aumenta quantos usos cabem na luta.", "Spirit Power raises each cast; the shorter cooldown raises how many casts fit in a fight."],
    ["Tankbuster", "trigger", 2, "O Spirit Power ajuda habilidades a passar dos 165 de dano que acionam o Tankbuster.", "The Spirit Power helps abilities clear the 165 damage that triggers Tankbuster."],
    ["Mystic Vulnerability", "amplify", 2, "Reduzir Spirit Resist multiplica o dano que o Spirit Power já aumentou.", "Lowering Spirit Resist multiplies damage the Spirit Power has already raised."],
    ["Mystic Shot", "amplify", 1, "O tiro carregado escala com Spirit Power e dá à arma parte do investimento.", "The charged bullet scales with Spirit Power and gives your gun part of the investment."],
  ],
  "Cursed Relic": [
    ["Knockdown", "setup", 3, "Use o Knockdown e, nos 2 s até o atordoamento, a maldição impede o alvo de reagir com habilidade ou item.", "Cast Knockdown and, during the 2s before the stun, the curse keeps the target from answering with an ability or item."],
    ["Slowing Hex", "setup", 3, "A maldição não prende ninguém: a lentidão e o bloqueio de mobilidade mantêm o alvo ao alcance do time.", "The curse holds no one in place: the slow and movement lock keep the target in your team's reach."],
    ["Superior Duration", "amplify", 2, "Os 3,25 s da maldição escalam com duração: mais tempo com o alvo sem arma, habilidade e item.", "The curse's 3.25s scales with duration: more time with the target out of gun, abilities and items."],
    ["Disarming Hex", "payoff", 2, "Encadeado quando a maldição acaba, mantém o atirador sem arma por mais 4,25 s.", "Chained as the curse ends, it keeps a gun carry disarmed for another 4.25s."],
    ["Silence Wave", "payoff", 2, "Encadeado quando a maldição acaba, mantém o conjurador silenciado por mais 3 s.", "Chained as the curse ends, it keeps a caster silenced for another 3s."],
    ["Decay", "payoff", 2, "O alvo não pode usar item ativo para limpar o Decay, e o dano por vida atual rende enquanto ele não reage.", "The target can't use an active item to cleanse Decay, and current-health damage ticks while they can't answer."],
    ["Warp Stone", "setup", 1, "A maldição tem só 20 m de alcance: o teleporte fecha a distância.", "The curse only has 20m range: the teleport closes the gap."],
  ],
  "Echo Shard": [
    ["Superior Duration", "amplify", 3, "Duas conjurações da mesma habilidade, as duas mais longas: dobra o ganho de duração.", "Two casts of the same ability, both longer: you collect the duration bonus twice."],
    ["Duration Extender", "amplify", 2, "Imbua a mesma habilidade: o bônus de duração vale nas duas conjurações.", "Imbue the same ability: the duration bonus applies to both casts."],
    ["Compress Cooldown", "amplify", 3, "Imbua a mesma habilidade: a recarga dela também soma na recarga do Echo Shard, então reduzir uma encurta as duas.", "Imbue the same ability: its cooldown is added to Echo Shard's, so cutting one shortens both."],
    ["Surge of Power", "amplify", 2, "Imbua a mesma habilidade: o Spirit Power permanente conta nas duas conjurações.", "Imbue the same ability: the permanent Spirit Power counts on both casts."],
    ["Greater Expansion", "amplify", 2, "Área maior nas duas conjurações seguidas da mesma habilidade.", "A larger area on both back-to-back casts."],
    ["Enchanter's Emblem", "amplify", 1, "Spirit Power e recarga para a habilidade repetida, enquanto você está com a vida alta.", "Spirit Power and cooldown for the repeated ability while your health is high."],
  ],
  "Escalating Exposure": [
    ["Torment Pulse", "trigger", 3, "Pulsa a cada 1,4 s sem você fazer nada: acumula e mantém os stacks de Spirit Amp em dois alvos.", "Pulses every 1.4s on its own: it builds and holds Spirit Amp stacks on two targets."],
    ["Alchemical Fire", "trigger", 2, "Área de dano de spirit por segundo: acumula stacks em vários inimigos ao mesmo tempo.", "A spirit damage-per-second area: it stacks on several enemies at once."],
    ["Superior Duration", "amplify", 2, "Os 12 s do stack escalam com duração, e habilidades de dano contínuo acumulam por mais tempo.", "The 12s stack window scales with duration, and damage-over-time abilities stack for longer."],
    ["Rapid Recharge", "trigger", 2, "Mais cargas são mais acertos de spirit para chegar aos 12 stacks.", "More charges mean more spirit hits toward the 12 stacks."],
    ["Radiant Regeneration", "cover", 1, "O dano de spirit que acumula stacks também dá regeneração, sustentando a luta longa de que o item precisa.", "The spirit damage building stacks also grants regen, sustaining the long fight this item needs."],
    ["Mystic Shot", "trigger", 1, "Dá à arma um acerto de spirit para abrir ou renovar os stacks entre habilidades.", "Gives your gun a spirit hit to open or refresh stacks between abilities."],
  ],
  "Ethereal Shift": [
    ["Warp Stone", "setup", 3, "Entre com o teleporte, jogue o combo e fique invulnerável enquanto os inimigos gastam a resposta.", "Blink in, drop your combo and turn invulnerable while enemies burn their answer."],
    ["Torment Pulse", "payoff", 1, "Você sai do vazio no meio da luta com Spirit Power extra, e o pulso acerta quem ficou em volta.", "You leave the void mid-fight with bonus Spirit Power, and the pulse hits whoever stayed around."],
    ["Compress Cooldown", "payoff", 2, "Os 4 s invulnerável são recarga de graça: a habilidade principal volta pronta, com Spirit Power extra.", "The 4s of invulnerability is free cooldown time: your main ability comes back ready, with bonus Spirit Power."],
    ["Superior Duration", "amplify", 2, "A invulnerabilidade de 4 s escala com duração.", "The 4s invulnerability scales with duration."],
    ["Decay", "payoff", 2, "Use o Decay e entre no vazio: o alvo perde vida atual enquanto não pode atacar você.", "Cast Decay and go into the void: the target loses current health while unable to hit you."],
    ["Dispel Magic", "cover", 2, "O vazio evita dano novo; o Dispel limpa o que já estava aplicado antes de você voltar para a luta.", "The void blocks new damage; Dispel clears what was already on you before you rejoin."],
  ],
  "Focus Lens": [
    ["Tankbuster", "payoff", 3, "Todo dano durante o silêncio volta em 35%: guarde o Tankbuster carregado para essa janela.", "35% of all damage during the silence is repeated: hold a charged Tankbuster for that window."],
    ["Superior Duration", "amplify", 3, "O silêncio de 4,5 s escala com duração: mais tempo para juntar dano na explosão final.", "The 4.5s silence scales with duration: more time to bank damage for the final burst."],
    ["Slowing Hex", "setup", 2, "O silêncio não impede de correr: a lentidão mantém o alvo no foco durante a janela.", "The silence doesn't stop running: the slow keeps the target in focus during the window."],
    ["Disarming Hex", "payoff", 2, "Silenciado e sem arma, o alvo não responde enquanto o dano acumula; a menos Bullet Resist também conta.", "Silenced and disarmed, the target can't answer while damage builds; the lost Bullet Resist counts too."],
    ["Decay", "payoff", 2, "O dano contínuo do Decay cai dentro da janela e é parte do que volta no fim.", "Decay's ticking damage lands inside the window and is part of what is repeated."],
    ["Mystic Vulnerability", "amplify", 1, "Soma na redução de Spirit Resist do Focus Lens durante a janela de foco.", "Adds to Focus Lens's Spirit Resist reduction during the focus window."],
  ],
  "Lightning Scroll": [
    ["Superior Duration", "amplify", 3, "Ultimate em área que dura mais pega mais alvos, e cada alvo novo leva o próprio atordoamento.", "An area ultimate that lasts longer catches more targets, and each new one takes its own stun."],
    ["Greater Expansion", "amplify", 3, "O efeito é uma vez por alvo: ultimate maior é mais gente atordoada.", "The effect is once per target: a larger ultimate stuns more people."],
    ["Superior Cooldown", "amplify", 2, "Só a ultimate aciona o item: ela voltar antes é mais um atordoamento em grupo.", "Only your ultimate triggers it: getting it back sooner is another group stun."],
    ["Compress Cooldown", "amplify", 2, "Imbua a ultimate, se ela aceitar, para ter o atordoamento em mais lutas.", "Imbue your ultimate, if it qualifies, to have the stun in more fights."],
    ["Majestic Leap", "setup", 2, "Entra por cima com barreira e posiciona a ultimate no centro do grupo.", "Drops in from above with a barrier and places your ultimate in the middle of the group."],
    ["Cold Front", "setup", 2, "O raio leva 3 s para cair: a lentidão mantém o alvo dentro da ultimate até lá.", "The bolt takes 3s to land: the slow keeps the target inside your ultimate until then."],
    ["Radiant Regeneration", "cover", 1, "A ultimate em área acerta vários heróis, e a regeneração acumula por herói acertado.", "An area ultimate hits several heroes, and the regen stacks per hero hit."],
  ],
  "Magic Carpet": [
    ["Superior Duration", "amplify", 2, "O voo de 12 s escala com duração: mais distância antes de pousar.", "The 12s flight scales with duration: more distance before landing."],
    ["Suppressor", "cover", 2, "Quem chega voando vira alvo: seu dano de spirit corta a cadência de quem atirar em você.", "Flying in makes you a target: your spirit damage cuts the fire rate of whoever shoots you."],
    ["Mystic Slow", "payoff", 2, "Chegar é o tapete; segurar é a lentidão que toda habilidade passa a aplicar.", "The carpet gets you there; the slow on every ability keeps them there."],
    ["Stamina Mastery", "amplify", 1, "Pulo ou dash aéreo extra aproveita o controle aéreo e a gravidade menor do item depois de saltar.", "An extra air jump or dash uses the item's air control and lower gravity after you jump off."],
  ],
  "Mercurial Magnum": [
    ["Surge of Power", "amplify", 3, "Imbua a mesma habilidade: um uso dá cadência duas vezes, Spirit Power nela e velocidade sem penalidade ao atirar.", "Imbue the same ability: one cast grants fire rate twice, Spirit Power on it and full speed while shooting."],
    ["Burst Fire", "payoff", 3, "Cadência em cima de cadência: mais balas com dano de spirit antes da próxima recarga.", "Fire rate on fire rate: more spirit-charged bullets before the next reload."],
    ["Spirit Shredder", "trigger", 2, "As balas passam a causar dano de spirit: o item reduz a resistência certa e devolve Spirit Lifesteal.", "Your bullets now deal spirit damage: this lowers the right resist and returns Spirit Lifesteal."],
    ["Titanic Magazine", "amplify", 3, "O bônus dura até recarregar: pente maior é mais balas com dano de spirit por uso.", "The bonus lasts until you reload: a bigger magazine is more spirit bullets per cast."],
    ["Spirit Lifesteal", "payoff", 2, "O dano de spirit das balas também cura.", "The bullets' spirit damage heals you too."],
    ["Kinetic Dash", "amplify", 2, "Dá munição extra e cadência até a próxima recarga, a mesma janela do Magnum.", "Grants extra ammo and fire rate until your next reload, the same window as Magnum."],
    ["Split Shot", "payoff", 2, "Com as balas carregadas, acertar vários heróis por tiro espalha o dano.", "With charged bullets, hitting several heroes per shot spreads the damage."],
  ],
  "Mystic Reverb": [
    ["Tankbuster", "trigger", 3, "O Reverb guarda e repete o dano do Tankbuster da habilidade imbuída; os dois ainda tiram vida atual.", "Reverb stores and repeats Tankbuster's damage on the imbued ability; both also cut current health."],
    ["Surge of Power", "amplify", 3, "Imbua a mesma habilidade: o dano maior é a base do que o Reverb repete em volta.", "Imbue the same ability: the bigger hit is the base of what Reverb repeats around the target."],
    ["Quicksilver Reload", "trigger", 2, "Imbua a mesma habilidade: o dano extra do primeiro acerto entra no eco.", "Imbue the same ability: the bonus damage on the first hit goes into the echo."],
    ["Greater Expansion", "amplify", 2, "O raio de 16 m do eco escala com alcance.", "The echo's 16m radius scales with range."],
    ["Compress Cooldown", "amplify", 2, "Imbua a mesma habilidade: cura, lentidão e eco voltam mais vezes (a recarga do Reverb é de só 6,25 s).", "Imbue the same ability: the heal, slow and echo come back more often (Reverb's own cooldown is just 6.25s)."],
    ["Mystic Vulnerability", "amplify", 1, "A resistência cai antes de o eco acertar, 3 s depois.", "Resist drops before the echo lands, 3s later."],
  ],
  Refresher: [
    ["Superior Duration", "amplify", 3, "Ultimates e áreas mais longas, duas vezes: a primeira ainda está ativa quando a segunda sai.", "Longer ultimates and areas, twice: the first can still be up when the second lands."],
    ["Greater Expansion", "amplify", 3, "Duas ultimates seguidas, as duas com área maior.", "Two ultimates in a row, both with a larger area."],
    ["Arcane Surge", "amplify", 2, "Um dash-jump antes de cada ultimate dá alcance, duração e Spirit Power às duas.", "A dash-jump before each ultimate gives both range, duration and Spirit Power."],
    ["Rapid Recharge", "trigger", 2, "O Refresher devolve todas as cargas: quanto mais cargas, mais ele devolve.", "Refresher restores every charge: the more charges you have, the more it gives back."],
    ["Warp Stone", "setup", 2, "Chega em posição para gastar o kit inteiro duas vezes.", "Gets you in position to spend your whole kit twice."],
    ["Majestic Leap", "setup", 1, "Entrada por cima com barreira para usar as duas ultimates no centro da luta.", "An entry from above with a barrier to use both ultimates in the middle of the fight."],
    ["Healing Booster", "amplify", 1, "Em kit de cura, as duas rodadas de habilidades curam mais.", "On a healing kit, both rounds of abilities heal more."],
  ],
  Scourge: [
    ["Torment Pulse", "payoff", 3, "Os dois causam dano em quem está perto: a resistência do Scourge paga a permanência no meio do grupo.", "Both damage whoever is near: Scourge's resists pay for standing in the middle of the group."],
    ["Superior Duration", "amplify", 3, "A aura tira 2,3% da vida máxima por segundo: cada segundo a mais é dano e resistência.", "The aura takes 2.3% of max health per second: every extra second is damage and resist."],
    ["Greater Expansion", "amplify", 2, "O raio de 10 m escala com alcance: mais inimigos presos na aura.", "The 10m radius scales with range: more enemies caught in the aura."],
    ["Cold Front", "setup", 2, "A lentidão em área mantém os inimigos dentro da aura.", "The area slow keeps enemies inside the aura."],
    ["Spirit Snatch", "payoff", 2, "Você já está colado no alvo: o melee rouba Spirit Resist e aumenta o dano da aura.", "You're already on the target: the melee steals Spirit Resist and raises the aura's damage."],
    ["Decay", "payoff", 2, "O Scourge corta pela vida máxima, o Decay pela atual: juntos derretem tanque.", "Scourge cuts by max health, Decay by current health: together they melt tanks."],
    ["Heroic Aura", "setup", 1, "Velocidade para o aliado com o Scourge alcançar e ficar em cima dos inimigos.", "Move speed for the ally carrying Scourge to reach and stay on enemies."],
  ],
  "Spirit Burn": [
    ["Tankbuster", "trigger", 3, "O golpe extra ajuda a juntar os 500 de dano de spirit em 5 s que acendem a queimadura.", "The extra hit helps reach the 500 spirit damage in 5s that lights the burn."],
    ["Decay", "trigger", 1, "O Decay normalmente não aciona itens, mas aciona o Spirit Burn (wiki); as duas reduções de cura pegam no alvo que tenta se salvar.", "Decay normally procs no items, but does proc Spirit Burn (wiki); both heal cuts hit a target trying to survive."],
    ["Mystic Vulnerability", "trigger", 2, "Menos Spirit Resist: chega antes ao limite de dano e queima mais forte.", "Less Spirit Resist: you reach the damage threshold sooner and burn harder."],
    ["Alchemical Fire", "trigger", 2, "Dano de spirit contínuo em área soma para o limite em vários alvos.", "Sustained area spirit damage counts toward the threshold on several targets."],
    ["Rapid Recharge", "trigger", 2, "Cargas em sequência concentram dano dentro dos 5 s.", "Back-to-back charges pack damage into the 5s window."],
    ["Torment Pulse", "trigger", 1, "Os pulsos completam o que faltou para o limite enquanto você está perto.", "The pulses fill in what's missing toward the threshold while you're close."],
  ],
  "Transcendent Cooldown": [
    ["Superior Duration", "amplify", 3, "Recarga menor com efeito mais longo: buffs, áreas e controles ficam ativos quase o tempo todo.", "Shorter cooldowns with longer effects: buffs, areas and control stay up almost all the time."],
    ["Torment Pulse", "amplify", 2, "Reduz recarga de item também: o pulso de 1,4 s sai mais vezes.", "It cuts item cooldowns too: the 1.4s pulse fires more often."],
    ["Radiant Regeneration", "trigger", 2, "Cura a cada habilidade usada: mais conjurações, mais cura, e a recarga do item também cai.", "Heals per ability cast: more casts, more healing, and its own cooldown drops too."],
    ["Warp Stone", "amplify", 2, "O ativo de 16 s volta a tempo de entrar e sair na mesma luta.", "The 16s active is back in time to go in and out in the same fight."],
    ["Rapid Recharge", "amplify", 2, "Soma recarga e tempo entre cargas para habilidades de carga.", "Combines cooldown and charge delay for charged abilities."],
    ["Rescue Beam", "amplify", 1, "Ativos longos (60 s) são os que mais ganham em segundos com os 25% em itens.", "Long actives (60s) gain the most seconds from the 25% on items."],
    ["Disarming Hex", "amplify", 1, "Com 16 s de base, o desarme chega perto de ficar em todo duelo.", "From a 16s base, the disarm comes close to being up in every duel."],
  ],
  "Vortex Web": [
    ["Alchemical Fire", "payoff", 3, "O vórtice junta todos num ponto pequeno: a poça de 10 m pega o grupo inteiro e ainda tira Bullet Resist.", "The vortex pulls everyone into a small spot: the 10m pool catches the whole group and strips Bullet Resist."],
    ["Silence Wave", "payoff", 3, "Inimigos empilhados são alvo fácil: silencia todos e tira a habilidade que usariam para sair.", "Stacked enemies are an easy target: it silences all of them and removes the ability they'd escape with."],
    ["Cold Front", "payoff", 2, "Com o grupo junto, a explosão acerta todos e soma 48% de lentidão ao bloqueio de mobilidade.", "With the group bunched, the blast hits everyone and adds a 48% slow to the movement lock."],
    ["Greater Expansion", "amplify", 3, "Raio de captura (12 m) e alcance (30 m) escalam com alcance: puxa mais gente de mais longe.", "Capture radius (12m) and cast range (30m) scale with range: it pulls more people from farther."],
    ["Superior Duration", "amplify", 2, "O efeito de 4 s escala com duração: mais tempo sem dash e sem mobilidade, e áreas suas duram mais em cima deles.", "The 4s effect scales with duration: longer without dashes or mobility, and your areas last longer on top of them."],
    ["Knockdown", "payoff", 2, "O atordoamento leva 2 s para cair e o alvo fica preso na área até lá.", "The stun takes 2s to land, and the target is stuck in the area until then."],
  ],
  // -------------------------------------------------------------- Vitality
  "Cheat Death": [
    ["Healbane", "cover", 2, "Na imunidade sua cura cai 60%; matar um alvo marcado dá uma cura grande logo no pior momento.", "During immunity your healing drops 60%; killing a marked target gives a big heal at the worst moment."],
    ["Warp Stone", "cover", 3, "Os 4,5 s sem morrer servem para sair: o teleporte tira você de perto antes de acabar.", "The 4.5s without dying is for getting out: the teleport gets you away before it ends."],
    ["Metal Skin", "cover", 1, "Ative na imunidade: quando ela acaba, as balas que matariam você ainda não entram.", "Use it during immunity: when that ends, the bullets that would kill you still don't land."],
    ["Dispel Magic", "cover", 2, "Salva depois do susto: limpa o que entrou durante a imunidade e cura.", "Saves you afterwards: it clears what was applied during immunity and heals."],
    ["Veil Walker", "cover", 1, "Furtividade e velocidade para terminar a fuga iniciada na imunidade.", "Stealth and speed to finish the escape started during immunity."],
  ],
  Colossus: [
    ["Melee Charge", "payoff", 3, "A lentidão em volta segura o alvo e o Heavy Melee chega com o bônus de melee do Colossus.", "The surrounding slow holds the target and the Heavy Melee lands with Colossus's melee bonus."],
    ["Lifestrike", "payoff", 3, "Cura em parte pelo dano de melee: os +30% do Colossus viram cura, e o golpe soma lentidão.", "Heals partly off melee damage: Colossus's +30% becomes healing, and the hit adds a slow."],
    ["Spirit Snatch", "payoff", 2, "Com a área lenta o melee conecta, e você ainda rouba Spirit Resist.", "In the slow field your melee connects, and you steal Spirit Resist too."],
    ["Hunter's Aura", "payoff", 2, "Duas auras no mesmo raio: quem fica perto perde velocidade, Bullet Resist e cadência.", "Two auras over the same radius: those near lose speed, Bullet Resist and fire rate."],
    ["Point Blank", "payoff", 2, "A área lenta mantém o alvo dentro dos 15 m que o bônus de arma exige.", "The slow field keeps targets inside the 15m the weapon bonus needs."],
    ["Berserker", "trigger", 1, "Você atrai o foco e aguenta: o dano recebido vira dano de arma.", "You draw focus and survive it: the damage taken becomes weapon damage."],
  ],
  "Divine Barrier": [
    ["Rescue Beam", "payoff", 3, "Limpe e proteja o aliado com 600 de barreira, depois puxe e cure: ele sobrevive ao canal de 2,5 s.", "Cleanse and shield the ally for 600, then pull and heal: they survive the 2.5s channel."],
    ["Healing Nova", "payoff", 2, "A barreira segura o dano enquanto a cura de 2 s entra, depois de remover debuffs do aliado.", "The barrier soaks damage while the 2s heal comes in, after clearing the ally's debuffs."],
    ["Heroic Aura", "payoff", 2, "A barreira e a velocidade iniciam o avanço de um aliado; a aura leva o time junto.", "The barrier and speed start one ally's push; the aura brings the team along."],
    ["Greater Expansion", "amplify", 1, "O alcance de 40 m escala: você salva sem entrar na luta.", "The 40m range scales: you save without joining the fight."],
    ["Restorative Locket", "cover", 2, "Segunda cura de recarga curta (20 s) para o próprio suporte, além da stamina para se reposicionar.", "A second, short-cooldown heal (20s) for the support, plus stamina to reposition."],
    ["Slowing Hex", "payoff", 1, "Proteja o aliado e segure quem o persegue: as duas metades de uma salvada.", "Shield the ally and hold the chaser: the two halves of a save."],
  ],
  "Diviner's Kevlar": [
    ["Superior Duration", "payoff", 3, "Os 20 s de Spirit Power e a barreira cobrem uma ultimate que também dura mais.", "The 20s of Spirit Power and the barrier cover an ultimate that also lasts longer."],
    ["Arcane Surge", "payoff", 2, "Dash-jump e ultimate: ela ganha alcance, duração e Spirit Power, e você cai com 1000 de barreira.", "Dash-jump into ultimate: it gains range, duration and Spirit Power, and you land with a 1000 barrier."],
    ["Superior Cooldown", "trigger", 2, "Ultimate mais frequente é mais barreira: a recarga do Kevlar é de só 40 s.", "A more frequent ultimate is more barriers: Kevlar's own cooldown is just 40s."],
    ["Compress Cooldown", "trigger", 2, "Imbua a ultimate, se ela aceitar: aproxima a recarga dela dos 40 s do Kevlar.", "Imbue your ultimate, if it qualifies: brings its cooldown closer to Kevlar's 40s."],
    ["Warp Stone", "setup", 1, "Ultimate, barreira e teleporte para dentro: a entrada fica segura.", "Ultimate, barrier, blink in: a safe entry."],
    ["Greater Expansion", "amplify", 1, "A ultimate com Spirit Power extra também acerta uma área maior.", "The ultimate with bonus Spirit Power also covers a larger area."],
  ],
  "Healing Tempo": [
    ["Radiant Regeneration", "trigger", 3, "Cada habilidade usada em combate cura você: mantém a cadência do Healing Tempo sem depender de kit de cura.", "Every ability cast in combat heals you: keeps Healing Tempo's fire rate up without a healing kit."],
    ["Healing Nova", "trigger", 3, "Cura em área: o time inteiro recebe cadência e velocidade.", "An area heal: the whole team gets fire rate and speed."],
    ["Rescue Beam", "trigger", 2, "Salva o aliado e ele sai do canal com cadência e velocidade para revidar.", "Saves the ally, who comes out with fire rate and speed to fight back."],
    ["Lifestrike", "trigger", 2, "A cura do melee é cura aplicada, não lifesteal passivo de bala, e liga o buff a cada poucos segundos.", "The melee heal is an applied heal, not passive bullet lifesteal, and turns the buff on every few seconds."],
    ["Restorative Locket", "trigger", 1, "Ativo de 20 s que cura e liga o buff quando o kit não cura.", "A 20s active that heals and triggers the buff when your kit doesn't heal."],
    ["Titanic Magazine", "payoff", 1, "Pente maior para gastar os 35% de cadência sem parar para recarregar.", "A bigger magazine to spend the 35% fire rate without stopping to reload."],
  ],
  Indomitable: [
    ["Warp Stone", "payoff", 2, "O controle é limpo na hora: o teleporte, que estaria bloqueado, tira você dali.", "The control is cleansed instantly: the teleport that would have been locked gets you out."],
    ["Spirit Shielding", "cover", 2, "Controle costuma vir com dano de spirit: as duas barreiras respondem ao mesmo combo inimigo.", "Control usually comes with spirit damage: both barriers answer the same enemy combo."],
    ["Dispel Magic", "cover", 2, "O Indomitable pega só o primeiro controle pesado; o Dispel limpa o resto dos debuffs.", "Indomitable only takes the first hard control; Dispel clears the remaining debuffs."],
    ["Melee Charge", "payoff", 1, "Quem entra para bater apanha controle: a limpeza e a barreira deixam o Heavy Melee acontecer.", "Going in to punch draws control: the cleanse and barrier let the Heavy Melee happen."],
    ["Point Blank", "payoff", 1, "Permite ficar nos 15 m sem morrer para o primeiro atordoamento.", "Lets you stay within 15m without dying to the first stun."],
    ["Counterspell", "cover", 1, "Duas respostas para controles diferentes: um aparado, o outro limpo. O Indomitable ativa mesmo quando o Counterspell anula (wiki).", "Two answers for different controls: one parried, one cleansed. Indomitable procs even when Counterspell negates it (wiki)."],
  ],
  Infuser: [
    ["Torment Pulse", "trigger", 3, "Com 75% de Spirit Lifesteal, cada pulso em dois alvos vira cura, e o Spirit Power aumenta o pulso.", "With 75% Spirit Lifesteal every two-target pulse is healing, and the Spirit Power raises the pulse."],
    ["Alchemical Fire", "trigger", 3, "A área acertando vários inimigos durante os 7 s cura por todos ao mesmo tempo.", "The area hitting several enemies over the 7s heals off all of them at once."],
    ["Cold Front", "trigger", 2, "Explosão em área de spirit dentro da janela: lentidão, dano e cura de uma vez.", "An area spirit blast inside the window: slow, damage and healing at once."],
    ["Mystic Vulnerability", "amplify", 2, "Lifesteal cura pelo dano causado: menos resistência é mais cura.", "Lifesteal heals off damage dealt: less resist is more healing."],
    ["Superior Duration", "amplify", 2, "Os 7 s escalam com duração, e suas áreas curam por mais tempo.", "The 7s scales with duration, and your areas heal for longer."],
    ["Healing Booster", "amplify", 2, "O lifesteal escala com bônus de cura.", "The lifesteal scales with healing bonuses."],
    ["Rapid Recharge", "trigger", 1, "Cargas em sequência concentram dano, e cura, nos 7 s.", "Back-to-back charges pack damage, and healing, into the 7s."],
  ],
  Inhibitor: [
    ["Swift Striker", "trigger", 2, "O efeito acumula por tiro: mais cadência aplica a redução de dano antes.", "It builds per shot: more fire rate applies the damage reduction sooner."],
    ["Titanic Magazine", "trigger", 3, "Precisa de muitas balas seguidas (o acúmulo some em 5 s): o pente grande evita parar no meio.", "It needs many bullets in a row (buildup decays in 5s): a big magazine avoids stopping midway."],
    ["Toxic Bullets", "trigger", 3, "Os dois acumulam com as mesmas balas: menos dano do inimigo, sangramento e pouca cura no mesmo alvo.", "Both build with the same bullets: less enemy damage, bleed and low healing on one target."],
    ["Active Reload", "trigger", 2, "A recarga instantânea mantém o acúmulo vivo e dá cadência para terminá-lo.", "The instant reload keeps the buildup alive and gives fire rate to finish it."],
    ["Split Shot", "trigger", 1, "Acertar vários heróis por tiro espalha o acúmulo na luta em grupo.", "Hitting several heroes per shot spreads the buildup in a team fight."],
    ["Escalating Resilience", "cover", 2, "As mesmas balas que enfraquecem o inimigo dão Bullet Resist a você: ganha a troca pelos dois lados.", "The same bullets that weaken the enemy give you Bullet Resist: you win the trade on both sides."],
    ["Fleetfoot", "setup", 1, "Atirar sem perder velocidade mantém você na cola até completar o acúmulo.", "Shooting at full speed keeps you on target until the buildup completes."],
  ],
  Juggernaut: [
    ["Escalating Resilience", "cover", 2, "O Juggernaut corta 40% da cadência de quem atira; a resistência reduz o que ainda entra.", "Juggernaut cuts 40% fire rate from shooters; the resist reduces what still lands."],
    ["Melee Charge", "payoff", 3, "Velocidade e resistência a lentidão para alcançar, e o Heavy Melee para aproveitar.", "Speed and slow resist to reach them, Heavy Melee to cash in."],
    ["Point Blank", "payoff", 2, "A velocidade mantém você dentro dos 15 m, e o duelo de perto favorece quem reduz a cadência.", "The speed keeps you within 15m, and a close duel favours whoever slows fire rate."],
    ["Fleetfoot", "amplify", 2, "Sem penalidade de velocidade ao atirar e mais resistência a lentidão: você alcança quem fugir.", "No move penalty while shooting plus more slow resist: no one outruns you."],
    ["Suppressor", "amplify", 2, "A segunda redução de cadência vale para o alvo que você acerta, mesmo que ele não atire em você.", "A second fire rate cut on targets you hit, even when they aren't shooting you."],
    ["Bullet Resilience", "cover", 1, "Com a vida baixa você ainda regenera e aguenta bala com a cadência inimiga cortada.", "At low health you keep regenerating and tank bullets at a reduced enemy fire rate."],
    ["Weighted Shots", "payoff", 1, "Você fica rápido e o alvo lento; a velocidade do Juggernaut compensa a perda do Weighted Shots.", "You get fast, the target slow; Juggernaut's speed offsets the Weighted Shots penalty."],
  ],
  Leech: [
    ["Healing Booster", "amplify", 3, "Os dois lifesteals escalam com bônus de cura.", "Both lifesteals scale with healing bonuses."],
    ["Spirit Shredder", "trigger", 2, "A bala aplica Spirit Lifesteal extra contra o alvo e reduz a resistência que limita a cura.", "Bullets add extra Spirit Lifesteal on the target and lower the resist limiting your healing."],
    ["Tesla Bullets", "trigger", 2, "Cada tiro cura como arma, e os choques em vários alvos curam como spirit.", "Each shot heals as weapon, and shocks on several targets heal as spirit."],
    ["Burst Fire", "trigger", 2, "Mais cadência é mais dano e mais cura; a velocidade ajuda a continuar acertando.", "More fire rate is more damage and healing; the speed helps you keep hitting."],
    ["Quicksilver Reload", "trigger", 2, "Um uso dá dano de spirit, recarga e cadência: alimenta os dois lifesteals.", "One cast gives spirit damage, a reload and fire rate: it feeds both lifesteals."],
    ["Escalating Resilience", "cover", 2, "Lifesteal não salva de explosão de dano: a resistência dá tempo para a cura entrar.", "Lifesteal can't save you from burst: the resist buys time for the healing."],
    ["Titanic Magazine", "trigger", 1, "Sem recarga não há pausa na cura.", "No reload means no gap in healing."],
  ],
  "Phantom Strike": [
    ["Point Blank", "payoff", 2, "Você cai em cima do alvo, lento e sem arma: todo tiro conta como perto.", "You land on a slowed, disarmed target: every shot counts as close range."],
    ["Melee Charge", "payoff", 3, "Teleporte, alvo no chão e lento: o Heavy Melee é praticamente garantido.", "Teleport, target grounded and slowed: the Heavy Melee is all but guaranteed."],
    ["Stalker", "payoff", 3, "Chega já dentro dos 8 m: a ferida abre, tira Bullet Resist e revela quem tentar fugir.", "You arrive inside 8m: the wound opens, strips Bullet Resist and reveals anyone fleeing."],
    ["Hunter's Aura", "payoff", 3, "Isolar um alvo com o teleporte dobra a aura: menos Bullet Resist e menos cadência.", "Isolating one target with the teleport doubles the aura: less Bullet Resist and fire rate."],
    ["Warp Stone", "cover", 2, "Um entra, o outro sai: a saída depois do mergulho.", "One goes in, the other gets out: your exit after the dive."],
    ["Slowing Hex", "payoff", 2, "Trava a mobilidade logo depois da queda: o alvo não usa habilidade de fuga.", "Locks movement right after the landing: no escape ability for the target."],
    ["Bullet Resist Shredder", "payoff", 2, "O impacto é dano de spirit e já tira Bullet Resist antes do primeiro tiro.", "The impact is spirit damage and strips Bullet Resist before your first shot."],
    ["Shadow Weave", "setup", 1, "Chega invisível até os 25 m e abre a emboscada com dano extra.", "Get within 25m unseen and open the ambush with bonus damage."],
  ],
  "Plated Armor": [
    ["Metal Skin", "cover", 3, "A armadura depende da sorte; o Metal Skin é a imunidade certa para a pior rajada.", "The armor is chance-based; Metal Skin is guaranteed immunity for the worst burst."],
    ["Bullet Resilience", "cover", 3, "Resistência reduz a bala que passou da deflexão, ainda mais com a vida baixa.", "Resist reduces the bullets that got past deflection, even more at low health."],
    ["Battle Vest", "payoff", 2, "Menos bala entrando mantém a vida acima de 65%, onde o colete dá dano e cadência.", "Fewer bullets landing keeps you above 65% health, where the vest grants damage and fire rate."],
    ["Return Fire", "payoff", 2, "Atiradores gastam balas que são desviadas e recebem tiros de volta.", "Shooters waste deflected bullets and get shot back."],
    ["Disarming Hex", "cover", 2, "Contra o atirador principal: metade dos efeitos de bala barrados e mais 4,25 s sem arma.", "Against the main gunner: half their on-hit effects blocked plus 4.25s disarmed."],
    ["Hunter's Aura", "amplify", 2, "Corta a cadência de quem está perto: menos tiros para passar pela deflexão.", "Cuts the fire rate of nearby enemies: fewer shots to get past deflection."],
    ["Weapon Shielding", "cover", 1, "A barreira pega a rajada que passou pela deflexão.", "The barrier catches the burst that got past deflection."],
  ],
  "Siphon Bullets": [
    ["Headhunter", "payoff", 3, "A cura percentual do headshot cresce com a vida máxima roubada.", "The headshot's percent heal grows with the stolen max health."],
    ["Fortitude", "payoff", 2, "Regenera por % da vida máxima: a vida roubada vira regeneração fora de troca.", "Regenerates a % of max health: stolen health becomes regen between trades."],
    ["Fleetfoot", "setup", 2, "O roubo é uma vez a cada 1,2 s: correr atirando sem penalidade mantém o contato.", "It steals once every 1.2s: full speed while shooting keeps contact."],
    ["Titanic Magazine", "trigger", 2, "Contato contínuo acumula roubo sem parar; pente maior evita a pausa.", "Constant contact keeps stealing; a bigger magazine avoids the pause."],
    ["Bullet Resist Shredder", "amplify", 1, "Em kit com dano de spirit, abate mais fácil quem já está com a vida máxima menor.", "With spirit damage in your kit, it finishes targets already at lower max health."],
    ["Hunter's Aura", "amplify", 2, "No duelo em que você acumula roubo, o alvo sozinho perde o dobro de Bullet Resist e cadência.", "In the duel where you stack steals, a lone target loses double Bullet Resist and fire rate."],
    ["Escalating Resilience", "cover", 2, "Os dois pedem tiros seguidos: você fica com mais vida e mais resistência a cada acerto.", "Both want sustained hits: you gain health and resist with each one."],
  ],
  Spellbreaker: [
    ["Spirit Shielding", "cover", 3, "O Spellbreaker corta o golpe grande; a barreira pega a sequência que vem logo depois.", "Spellbreaker cuts the big hit; the barrier catches the follow-up."],
    ["Spirit Resilience", "cover", 2, "Cobre o dano de spirit pequeno e contínuo, que não chega aos 175 do Spellbreaker.", "Covers small, sustained spirit damage that never reaches Spellbreaker's 175."],
    ["Counterspell", "cover", 2, "Apare a habilidade que controla e deixe o Spellbreaker para a que causa dano.", "Parry the controlling ability and leave Spellbreaker for the damaging one."],
    ["Enchanter's Emblem", "payoff", 2, "Sem levar a explosão você fica acima de 65% de vida, onde o Emblem dá Spirit e recarga.", "Without the burst you stay above 65% health, where Emblem grants Spirit and cooldown."],
    ["Battle Vest", "payoff", 2, "Cobre bala, e a vida alta preservada contra magia mantém o dano e a cadência do colete.", "Covers bullets, and the health kept against spells keeps the vest's damage and fire rate on."],
    ["Dispel Magic", "cover", 1, "Um reduz o dano da habilidade, o outro remove o debuff que veio junto.", "One cuts the ability's damage, the other removes the debuff that came with it."],
  ],
  Unstoppable: [
    ["Warp Stone", "setup", 3, "Imune a controle, o teleporte leva você para o centro sem ser parado na entrada.", "Immune to control, the teleport takes you to the middle without being stopped on the way in."],
    ["Arcane Surge", "payoff", 2, "Na janela segura, dash-jump e ultimate reforçada sem ninguém interromper.", "In the safe window, dash-jump into an empowered ultimate nobody can interrupt."],
    ["Split Shot", "payoff", 2, "Sem desarme por 5,5 s: entra no grupo e usa todo o Split Shot (5 s).", "No disarm for 5.5s: walk into the group and use the full 5s of Split Shot."],
    ["Hunter's Aura", "payoff", 2, "Você anda pelo meio do grupo sem ser controlado, e a aura enfraquece quem está em volta.", "You walk through the group uncontrolled, and the aura weakens everyone around."],
    ["Metal Skin", "cover", 2, "Imune a controle e a bala ao mesmo tempo: sobra só o dano de spirit.", "Immune to control and bullets at once: only spirit damage is left."],
    ["Dispel Magic", "cover", 1, "Para o debuff que já estava em você fora da janela de imunidade.", "For debuffs on you outside the immunity window."],
  ],
  "Vampiric Burst": [
    ["Titanic Magazine", "amplify", 3, "Recarrega 75% do pente e pode passar do máximo: pente maior é mais bala (e cura) na janela.", "Refills 75% of your magazine and can exceed the max: a bigger magazine is more bullets (and healing) in the window."],
    ["Split Shot", "payoff", 3, "Cada tiro acerta vários heróis e cura por todos, com 75% de lifesteal.", "Each shot hits several heroes and heals off all of them, at 75% lifesteal."],
    ["Blood Tribute", "cover", 3, "O custo em vida some no lifesteal, e a cadência dos dois soma.", "The health cost vanishes in the lifesteal, and both fire rates add up."],
    ["Berserker", "payoff", 2, "O dano que você levou virou stacks: dano de arma alto na hora em que ele cura mais.", "The damage you took became stacks: high weapon damage right when it heals most."],
    ["Burst Fire", "amplify", 2, "Cadência somada na mesma janela de 5 s, com velocidade para continuar acertando.", "Stacked fire rate in the same 5s window, with speed to keep hitting."],
    ["Point Blank", "payoff", 2, "De perto sua arma causa mais dano, e 75% dele vira cura enquanto você aguenta a troca.", "Up close your gun deals more, and 75% of it heals you through the trade."],
  ],
  Witchmail: [
    ["Superior Cooldown", "amplify", 2, "Soma com os 4 s que cada golpe de spirit devolve: as habilidades voltam dentro da luta.", "Adds to the 4s each spirit hit gives back: abilities return mid-fight."],
    ["Berserker", "trigger", 2, "Os dois pedem apanhar: o mesmo dano devolve recarga e vira dano de arma.", "Both want you to be hit: the same damage gives cooldown and weapon damage."],
    ["Enchanter's Emblem", "payoff", 2, "A resistência mantém a vida acima de 65%, e aí entram mais recarga e Spirit Power.", "The resist keeps health above 65%, which adds more cooldown and Spirit Power."],
    ["Torment Pulse", "payoff", 2, "Você quer ficar no meio da luta para ser atingido, e o pulso castiga quem está perto.", "You want to be in the middle getting hit, and the pulse punishes those nearby."],
    ["Suppressor", "cover", 2, "O Witchmail só cobre spirit; o Suppressor reduz a cadência de quem atira.", "Witchmail only covers spirit; Suppressor cuts shooters' fire rate."],
    ["Spirit Shielding", "cover", 2, "A barreira absorve a mesma rajada de spirit que devolve suas recargas.", "The barrier absorbs the same spirit burst that refunds your cooldowns."],
    ["Lifestrike", "cover", 1, "Recupera vida entre um golpe e outro para continuar recebendo.", "Restores health between hits so you can keep taking them."],
  ],
  // ---------------------------------------------------------------- Weapon
  "Armor Piercer": [
    ["Express Shot", "payoff", 3, "Um tiro com dano muito alto é o melhor alvo para 60% de chance de ignorar a resistência.", "A very high damage shot is the best use of a 60% chance to ignore resist."],
    ["Sharpshooter", "payoff", 2, "Com bala mais rápida e imparável, o dano extra de longe chega mesmo em alvo resistente.", "With faster, unavoidable bullets the long-range damage lands even on tanky targets."],
    ["Titanic Magazine", "amplify", 2, "Mais balas sem recarga contra o tanque que você agora fura.", "More bullets without reloading into the tank you now pierce."],
    ["Split Shot", "payoff", 2, "Os tiros atravessam inimigos: em grupo, cada rajada passa por mais gente.", "Bullets pierce enemies: in a group each volley passes through more people."],
    ["Weighted Shots", "amplify", 2, "Dano de arma puro que não depende de reduzir resistência, e lentidão para manter a linha de tiro.", "Raw weapon damage that needs no resist shred, plus a slow to keep the line of fire."],
    ["Escalating Resilience", "cover", 1, "Você ignora a resistência dele e acumula a sua.", "You ignore their resist while stacking your own."],
    ["Toxic Bullets", "payoff", 1, "Contra tanque: a bala ignora a resistência, o sangramento corta pela vida máxima.", "Against tanks: bullets ignore resist, the bleed cuts by max health."],
  ],
  Capacitor: [
    ["Torment Pulse", "payoff", 2, "O ativo prende o alvo sem stamina e sem mobilidade perto de você, e o pulso acerta.", "The active pins the target without stamina or mobility near you, and the pulse hits."],
    ["Bullet Resist Shredder", "trigger", 3, "Os choques causam dano de spirit: a bala comum passa a reduzir Bullet Resist sozinha.", "The shocks deal spirit damage: your normal bullets now strip Bullet Resist on their own."],
    ["Swift Striker", "trigger", 2, "O choque é chance por tiro: mais cadência é mais choque em cadeia.", "Shocks are chance-per-shot: more fire rate means more chains."],
    ["Toxic Bullets", "trigger", 2, "Mesma arma, dois efeitos: choque em grupo e sangramento no alvo principal.", "One gun, two effects: group shocks and a bleed on the main target."],
    ["Titanic Magazine", "trigger", 2, "Mais tiros seguidos é mais chance de choque antes de recarregar.", "More shots in a row is more shock chances before reloading."],
    ["Stalker", "payoff", 2, "O alvo preso pelo ativo não sai dos 8 m: a ferida abre e os choques batem com menos Bullet Resist para a arma.", "A target pinned by the active can't leave 8m: the wound opens and your gun hits into less Bullet Resist."],
    ["Mystic Vulnerability", "trigger", 1, "Os choques aplicam a redução de Spirit Resist em vários alvos e se beneficiam dela.", "Shocks apply the Spirit Resist cut on several targets and benefit from it."],
  ],
  "Crippling Headshot": [
    ["Headhunter", "trigger", 3, "O headshot que aplica o debuff também dá dano, cura e velocidade; os próximos batem com menos resistência.", "The headshot that applies the debuff also grants damage, a heal and speed; the next ones hit into less resist."],
    ["Spirit Rend", "trigger", 2, "Os dois pedem headshot e reduzem Spirit Resist: abre o alvo para um time de magia.", "Both want headshots and cut Spirit Resist: it opens the target for a spirit team."],
    ["Bullet Resist Shredder", "amplify", 2, "Outra redução de Bullet Resist por cima da do headshot, acionada pelo dano de spirit.", "Another Bullet Resist cut on top of the headshot's, triggered by spirit damage."],
    ["Sharpshooter", "payoff", 2, "Zoom e velocidade de bala ajudam no headshot, e o dano extra entra com a resistência reduzida.", "Zoom and bullet velocity help headshots, and the bonus damage lands into reduced resist."],
    ["Toxic Bullets", "amplify", 2, "Alvo com pouca cura, menos resistência e sangrando: não sobrevive por lifesteal.", "Low healing, low resist and bleeding: the target can't lifesteal through it."],
    ["Hollow Point", "amplify", 1, "Dano extra e mais uma redução de Bullet Resist com a vida alta.", "Extra damage and another Bullet Resist cut at high health."],
  ],
  "Crushing Fists": [
    ["Lifestrike", "trigger", 3, "Cada melee aplica stacks, cura pelo dano (já aumentado) e deixa o alvo lento para o próximo.", "Each melee stacks, heals off the (boosted) damage and slows the target for the next."],
    ["Spirit Snatch", "trigger", 3, "O mesmo golpe soma dano de spirit e rouba resistência: o alvo perde Bullet e Spirit Resist.", "The same hit adds spirit damage and steals resist: the target loses Bullet and Spirit Resist."],
    ["Point Blank", "payoff", 3, "O melee tira Bullet Resist e devolve munição; de perto, a arma termina o serviço.", "Melee strips Bullet Resist and returns ammo; at close range your gun finishes the job."],
    ["Hunter's Aura", "amplify", 2, "Mais Bullet Resist removida de quem está no alcance do soco.", "More Bullet Resist stripped from anyone in punching range."],
    ["Bullet Resist Shredder", "amplify", 2, "Com o dano de spirit do Spirit Snatch, soma à redução por stacks.", "With Spirit Snatch's spirit damage, it adds to the stacking reduction."],
    ["Slowing Hex", "setup", 2, "Alvo lento e sem mobilidade não escapa dos melees até o atordoamento.", "A slowed target without mobility can't escape the melees before the stun."],
    ["Enduring Speed", "setup", 1, "Velocidade e resistência a lentidão para chegar ao alvo.", "Speed and slow resist to reach the target."],
    ["Berserker", "payoff", 1, "Brigar colado custa dano, que vira dano de arma para as balas devolvidas.", "Brawling costs health, which becomes weapon damage for the returned bullets."],
  ],
  Frenzy: [
    ["Berserker", "trigger", 3, "Para cair abaixo de 50% você levou o dano que enche o Berserker: os dois bônus ligam juntos.", "Dropping below 50% means you took the damage that fills Berserker: both bonuses turn on together."],
    ["Blood Tribute", "trigger", 3, "Gasta a própria vida para entrar na faixa de 50% e já soma cadência.", "Spends your own health to enter the 50% range while adding fire rate."],
    ["Bullet Resilience", "cover", 2, "Liga na mesma faixa: abaixo de 50% você bate mais e recebe menos bala.", "Turns on in the same range: below 50% you hit harder and take fewer bullets."],
    ["Spirit Resilience", "cover", 2, "Liga na mesma faixa de vida contra dano de spirit.", "Turns on in the same health range against spirit damage."],
    ["Burst Fire", "amplify", 2, "Cadência e velocidade somadas na virada da luta.", "Stacked fire rate and speed for the turnaround."],
    ["Active Reload", "amplify", 2, "Com a cadência alta o pente acaba logo: recarga instantânea, mais cadência e lifesteal.", "High fire rate empties the magazine fast: instant reload, more fire rate and lifesteal."],
    ["Superior Duration", "amplify", 1, "Os 10 s do bônus escalam com duração.", "The 10s bonus scales with duration."],
  ],
  "Glass Cannon": [
    ["Sharpshooter", "cover", 3, "O dano vem de longe: a vida perdida pesa menos quando o inimigo não alcança você.", "The damage comes from range: the lost health matters less if enemies can't reach you."],
    ["Bullet Lifesteal", "cover", 3, "Lifesteal cura pelo dano: os +85% de arma viram vida para compensar a perda.", "Lifesteal heals off damage: +85% weapon becomes health to offset the loss."],
    ["Titanic Magazine", "amplify", 2, "Mais balas com +85% de dano, e a cadência dos abates gasta o pente mais rápido.", "More bullets at +85% damage, and the kill-stacked fire rate empties the magazine faster."],
    ["Burst Fire", "cover", 2, "Cadência para abater antes e velocidade para não ser alcançado.", "Fire rate to kill first and speed to avoid being caught."],
    ["Headhunter", "cover", 2, "Cura e velocidade a cada headshot para quem tem menos vida.", "A heal and speed per headshot for someone with less health."],
    ["Weighted Shots", "setup", 2, "Soma lentidão à do Glass Cannon: ninguém chega perto do atirador.", "Adds a slow to Glass Cannon's own: no one gets near the shooter."],
    ["Kinetic Dash", "amplify", 2, "Munição e cadência com mobilidade, para bater e reposicionar.", "Ammo and fire rate with mobility, to hit and reposition."],
    ["Fury Trance", "cover", 1, "Spirit Resist e cadência na janela em que você precisa ficar atirando.", "Spirit Resist and fire rate in the window you must keep shooting."],
  ],
  "Lucky Shot": [
    ["Swift Striker", "trigger", 2, "25% de chance por bala: mais cadência é mais tiro com sorte.", "25% chance per bullet: more fire rate, more lucky shots."],
    ["Express Shot", "trigger", 2, "Dispara duas balas de dano alto: se a sorte sair nelas, o bônus de 100% é sobre mais dano de arma.", "Fires two high-damage bullets: two chances at the 100% weapon damage bonus."],
    ["Weighted Shots", "amplify", 2, "O bônus escala com dano de arma, e a lentidão mantém o alvo na mira.", "The bonus scales with weapon damage, and the slow keeps the target in your sights."],
    ["Sharpshooter", "amplify", 2, "Aumenta o dano de arma que o tiro com sorte dobra.", "Raises the weapon damage the lucky shot doubles."],
    ["Bullet Lifesteal", "payoff", 2, "Os tiros com sorte são dano de arma: curam mais.", "Lucky shots are weapon damage: they heal more."],
    ["Kinetic Dash", "trigger", 2, "Munição e cadência extras são mais tentativas de sorte.", "Extra ammo and fire rate are more rolls."],
    ["Hunter's Aura", "amplify", 1, "Menos Bullet Resist para todos os tiros, com sorte ou não.", "Less Bullet Resist for every shot, lucky or not."],
  ],
  Ricochet: [
    ["Toxic Bullets", "trigger", 3, "O ricochete aplica efeitos de bala: o sangramento acumula em mais dois inimigos.", "Ricochets apply bullet procs: the bleed builds on two more enemies."],
    ["Spirit Shredder", "trigger", 3, "Cada ricochete marca outro alvo com menos Spirit Resist e lifesteal para o time.", "Each ricochet marks another target with less Spirit Resist and lifesteal for the team."],
    ["Escalating Resilience", "cover", 1, "Atirar sem parar no grupo é como o Ricochet rende, e cada tiro dá Bullet Resist.", "Constant fire into a group is how Ricochet pays off, and each shot grants Bullet Resist."],
    ["Bullet Lifesteal", "payoff", 2, "O dano ricocheteado também é dano de arma: cura por até três alvos.", "Ricochet damage is weapon damage too: heals off up to three targets."],
    ["Titanic Magazine", "amplify", 2, "Cada bala a mais no pente são até três acertos.", "Every extra bullet in the magazine is up to three hits."],
    ["Slowing Bullets", "trigger", 2, "A lentidão acumula também nos alvos do ricochete.", "The slow builds on ricochet targets too."],
  ],
  Silencer: [
    ["Swift Striker", "trigger", 3, "O silêncio acumula por tiro: cadência decide se ele sai antes da habilidade do inimigo.", "The silence builds per shot: fire rate decides whether it lands before the enemy's ability."],
    ["Titanic Magazine", "trigger", 2, "O acúmulo some em 5 s: pente grande evita recarregar no meio.", "Buildup decays in 5s: a big magazine avoids reloading midway."],
    ["Active Reload", "trigger", 2, "Recarga instantânea e cadência para não perder o acúmulo.", "Instant reload and fire rate so you don't lose the buildup."],
    ["Slowing Hex", "payoff", 2, "Silenciado, lento e sem item de mobilidade: o alvo não tem como sair.", "Silenced, slowed and without movement items: the target has no way out."],
    ["Fleetfoot", "setup", 2, "Correr atirando sem penalidade mantém o contato até o silêncio.", "Full speed while shooting keeps contact until the silence."],
    ["Weighted Shots", "trigger", 2, "As mesmas balas acumulam lentidão e silêncio no alvo.", "The same bullets build both slow and silence."],
    ["Spirit Resilience", "cover", 1, "O Silencer reduz o dano de spirit do alvo; a resistência cobre os outros inimigos.", "Silencer cuts the target's spirit damage; the resist covers the other enemies."],
    ["Disarming Hex", "payoff", 1, "Sem habilidade pelas balas e sem arma pelo Hex: o duelo acaba.", "No abilities from your bullets and no gun from the Hex: the duel is over."],
  ],
  Spellslinger: [
    ["Fleetfoot", "trigger", 3, "Ativo de 16 s que conta como conjuração: dá stack e ainda tira a penalidade de velocidade ao atirar.", "A 16s active that counts as a cast: it gives a stack and removes the move penalty while shooting."],
    ["Fury Trance", "trigger", 2, "O uso dá um stack e soma 32% de cadência; use por último, porque ele silencia você.", "Using it gives a stack and adds 32% fire rate; use it last, since it silences you."],
    ["Titanic Magazine", "payoff", 2, "Com até 66% de cadência o pente some: munição para os 18 s do buff.", "At up to 66% fire rate magazines vanish: ammo for the 18s buff."],
    ["Spirit Shredder", "payoff", 2, "Muitas balas mantêm a redução de Spirit Resist para as habilidades que dão os stacks.", "Many bullets keep the Spirit Resist cut up for the abilities that give the stacks."],
    ["Rapid Recharge", "trigger", 2, "Cada carga usada é um stack.", "Each charge spent is a stack."],
    ["Battle Vest", "amplify", 2, "Dano de arma e cadência na vida alta, para balas que saem muito mais rápido.", "Weapon damage and fire rate at high health, for bullets that come out much faster."],
    ["Bullet Resist Shredder", "payoff", 2, "As habilidades que dão stacks também reduzem Bullet Resist antes da rajada.", "The abilities that grant stacks also cut Bullet Resist before the barrage."],
    ["Quicksilver Reload", "trigger", 2, "A habilidade imbuída dá stack, cadência e pente cheio de uma vez.", "The imbued ability gives a stack, fire rate and a full magazine at once."],
  ],
  "Spiritual Overflow": [
    ["Spirit Shredder", "trigger", 3, "As balas que carregam o Overflow reduzem Spirit Resist, e o Spirit Power ganho aproveita.", "The bullets that charge Overflow cut Spirit Resist, and the Spirit Power gained uses it."],
    ["Spirit Rend", "trigger", 2, "Versão maior da mesma ideia: mais redução com headshot e lifesteal para o time.", "The bigger version of the idea: more shred on headshots and lifesteal for the team."],
    ["Quicksilver Reload", "trigger", 3, "Recarrega e dá cadência: completa a carga do Overflow, e o Spirit Power aumenta a habilidade imbuída.", "Reloads and adds fire rate: finishes the Overflow charge, and Spirit Power raises the imbued ability."],
    ["Toxic Bullets", "trigger", 2, "Acumula com as mesmas balas, e o sangramento escala com o Spirit Power ganho.", "Builds with the same bullets, and the bleed scales with the Spirit Power gained."],
    ["Tesla Bullets", "payoff", 2, "Os choques escalam com Spirit Power e curam pelo Spirit Lifesteal.", "Shocks scale with Spirit Power and heal through Spirit Lifesteal."],
    ["Surge of Power", "payoff", 2, "Velocidade total atirando e cadência para carregar, Spirit Power na habilidade para descarregar.", "Full speed while shooting and fire rate to charge, Spirit Power on the ability to unload."],
    ["Superior Duration", "amplify", 1, "Os 15 s do bônus escalam com duração.", "The 15s bonus scales with duration."],
    ["Mystic Shot", "payoff", 1, "A bala carregada escala com o Spirit Power ganho.", "The charged bullet scales with the Spirit Power gained."],
  ],
};

export const ITEM_COMBOS: ItemCombo[] = Object.entries(ROWS).flatMap(([t4, rows]) => rows.map(([partner, kind, strength, pt, en]) => ({ t4, partner, kind, strength, pt, en })));

export const comboText = (c: ItemCombo): string => tr(c.pt, c.en);

/** Papéis na ordem em que a tela mostra. */
export const COMBO_KINDS: ComboKind[] = ["setup", "payoff", "trigger", "amplify", "cover"];

/** Todos os itens que entram na receita de um item, direta ou indiretamente. */
export function recipeOf(data: GameData, item: Item, seen = new Set<string>()): Set<string> {
  for (const cls of item.components) {
    if (seen.has(cls)) continue;
    seen.add(cls);
    const component = data.items.find((i) => i.className === cls);
    if (component) recipeOf(data, component, seen);
  }
  return seen;
}

/**
 * Com que frequência os compradores de um T4 também compram cada T2/T3
 * (data/snapshot/copurchase.json, `npm run copurchase`). O esperado controla por herói e
 * por souls do jogador, para não confundir "combina" com "o herói sempre compra".
 */
export interface CopurchaseStats {
  matches: number;
  players: number;
  /** class_name do T4 → quantos jogadores compraram e, por T2/T3, [quantos compraram os dois, quantos eram esperados]. */
  items: Record<string, { buyers: number; partners: Record<string, [both: number, expected: number]> }>;
}

export interface PairEvidence {
  /** Fração dos compradores do T4 que também compram o parceiro. */
  rate: number;
  /** Vezes o esperado (1 = igual a qualquer jogador do mesmo herói com os mesmos souls). */
  lift: number;
}

/** Abaixo disto a razão é ruído. */
export const MIN_EXPECTED = 50;

export function pairEvidence(data: GameData, t4: Item, partner: Item): PairEvidence | null {
  const row = data.copurchase?.items[t4.className];
  const pair = row?.partners[partner.className];
  if (!row || !pair || pair[1] < MIN_EXPECTED) return null;
  return { rate: pair[0] / row.buyers, lift: pair[0] / pair[1] };
}

export interface ComboView {
  combo: ItemCombo;
  t4: Item;
  partner: Item;
  evidence: PairEvidence | null;
}

/** Combos de um item: os T2/T3 de um T4, ou os T4 em que um T2/T3 entra. Mais fortes primeiro. */
export function combosOf(data: GameData, item: Item): ComboView[] {
  const byName = new Map(data.items.map((i) => [i.name, i]));
  return ITEM_COMBOS.filter((c) => c.t4 === item.name || c.partner === item.name)
    .flatMap((combo) => {
      const t4 = byName.get(combo.t4);
      const partner = byName.get(combo.partner);
      return t4 && partner ? [{ combo, t4, partner, evidence: pairEvidence(data, t4, partner) }] : [];
    })
    .sort((a, b) => b.combo.strength - a.combo.strength || (b.evidence?.lift ?? 0) - (a.evidence?.lift ?? 0));
}

/** T2/T3 que os compradores do T4 compram bem acima do esperado e que a análise não cobre. */
export function unexplainedPartners(data: GameData, t4: Item, limit = 4): { item: Item; evidence: PairEvidence }[] {
  const covered = new Set(ITEM_COMBOS.filter((c) => c.t4 === t4.name).map((c) => c.partner));
  const recipe = recipeOf(data, t4);
  return data.items
    .filter((i) => (i.tier === 2 || i.tier === 3) && !covered.has(i.name) && !recipe.has(i.className))
    .flatMap((item) => {
      const evidence = pairEvidence(data, t4, item);
      return evidence && evidence.lift >= 1.25 && evidence.rate >= 0.05 ? [{ item, evidence }] : [];
    })
    .sort((a, b) => b.evidence.lift - a.evidence.lift)
    .slice(0, limit);
}
