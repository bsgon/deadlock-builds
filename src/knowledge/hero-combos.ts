/**
 * Heróis que aproveitam cada T4 e qual habilidade faz o item render. Mesma ideia de
 * item-combos.ts: o que um efeito faz pelo outro, não atributo em comum. Os heróis saem
 * de quem compra o item acima da média; o motivo, da leitura do kit.
 */
import type { GameData, Hero, Item } from "../data/types.ts";
import { heroMeta } from "../meta/stats.ts";
import { tr } from "../i18n.ts";

type Row = [hero: string, pt: string, en: string];

export const HERO_COMBOS: Record<string, Row[]> = {
  // ---------------------------------------------------------------- Spirit
  "Arctic Blast": [
    ["Calico", "Congelado, o alvo fica parado para o Gloom Bombs e o Leaping Slash; ela já mergulha no meio do grupo.", "A frozen target stands still for Gloom Bombs and Leaping Slash; she already dives into the group."],
    ["Mo & Krill", "Sai do Burrow no meio deles e congela: ninguém foge do Scorn nem do Combo.", "Comes out of Burrow among them and freezes: no one escapes Scorn or Combo."],
    ["Pocket", "Teleporta com o Flying Cloak, congela o grupo e deixa Affliction e Barrage acertarem.", "Teleports with Flying Cloak, freezes the group and lets Affliction and Barrage land."],
    ["Drifter", "Aparece atrás do alvo com o Stalker's Mark e o congelamento garante o Rend de perto.", "Appears behind the target with Stalker's Mark, and the freeze guarantees a close Rend."],
  ],
  "Boundless Spirit": [
    ["Grey Talon", "Guided Owl já acumula Spirit Power permanente; o Boundless aumenta tudo isso em porcentagem.", "Guided Owl already stacks permanent Spirit Power; Boundless multiplies all of it."],
    ["Mina", "Dano de spirit em cada bala e nas mordidas do Love Bites: o mesmo ponto rende em tudo.", "Spirit damage on every bullet and Love Bites proc: each point pays off everywhere."],
    ["Sinclair", "O Vexing Bolt sai duas vezes com o Assistente: o Spirit Power conta nas duas.", "Vexing Bolt fires twice with the Assistant: Spirit Power counts on both."],
    ["Lash", "Ground Strike, Flog e Death Slam no mesmo mergulho: três golpes de spirit de uma vez.", "Ground Strike, Flog and Death Slam in one dive: three spirit hits at once."],
  ],
  "Cursed Relic": [
    ["Rem", "Deixa o alvo sem resposta enquanto o Naptime canaliza, e o dano que ela perde pouco importa no suporte.", "Leaves the target without an answer while Naptime channels, and a support barely misses the lost damage."],
    ["Paige", "Suporte que pouco sente a perda de dano: a maldição segura quem ameaça o aliado com Plot Armor.", "A support who barely feels the damage loss: the curse shuts down whoever threatens the Plot Armor ally."],
    ["The Doorman", "Puxa com o Luggage Cart e amaldiçoa: o alvo isolado não usa item para escapar.", "Pulls with Luggage Cart and curses: the isolated target can't use items to escape."],
    ["Holliday", "Laça, traz para o time e amaldiçoa: quando o Spirit Lasso acaba, o alvo continua sem reagir.", "Lasso, drag into the team and curse: the target still can't respond once Spirit Lasso ends."],
  ],
  "Echo Shard": [
    ["Bebop", "Duas Sticky Bombs seguidas no mesmo alvo, que ainda alimentam o bônus permanente.", "Two Sticky Bombs in a row on one target, both feeding the permanent bonus."],
    ["Rem", "Repete o Tag Along: duas rodadas de cura em teamfight.", "Repeats Tag Along: two rounds of healing in a team fight."],
    ["Ivy", "Dois Stone Forms seguidos: dois atordoamentos em área e duas curas.", "Two Stone Forms in a row: two area stuns and two heals."],
    ["Paradox", "Duas Pulse Grenades sobrepostas: os pulsos acumulam mais dano contra a mesma vítima.", "Two overlapping Pulse Grenades: the pulses stack more damage on the same victim."],
    ["Viscous", "The Cube duas vezes: salva dois aliados, ou o mesmo por mais tempo.", "The Cube twice: saves two allies, or one for longer."],
  ],
  "Escalating Exposure": [
    ["Victor", "Aura of Suffering causa dano contínuo de perto: enche os stacks e cresce junto com eles.", "Aura of Suffering deals constant close damage: it fills the stacks and grows with them."],
    ["Seven", "Storm Cloud, Lightning Ball e Power Surge acertam sem parar, em vários alvos.", "Storm Cloud, Lightning Ball and Power Surge hit nonstop, on several targets."],
    ["Infernus", "Napalm, Flame Dash e Afterburn mantêm o alvo queimando: os stacks não caem.", "Napalm, Flame Dash and Afterburn keep the target burning: the stacks never drop."],
    ["Kelvin", "O Arctic Beam é dano sustentado no mesmo alvo, exatamente o que acumula.", "Arctic Beam is sustained damage on one target, exactly what stacks it."],
    ["McGinnis", "As Mini Turrets atiram dano de spirit sozinhas e acumulam por ela.", "Mini Turrets fire spirit damage on their own and stack for her."],
  ],
  "Ethereal Shift": [
    ["Pocket", "O Affliction continua causando dano enquanto Pocket fica invulnerável no meio do grupo.", "Affliction keeps ticking while Pocket is invulnerable in the middle of the group."],
    ["Victor", "Entra, vira alvo de todos e usa o vazio para ganhar tempo de recarga.", "Walks in, draws everyone's focus and uses the void to buy cooldown time."],
    ["Shiv", "O Bloodletting adia o dano recebido, e o vazio dá tempo para ele voltar e limpar.", "Bloodletting defers the damage taken, and the void buys time for it to come back and clear it."],
    ["Mina", "Depois do Sanguine Retreat ela não tem saída: o vazio evita a resposta enquanto ele recarrega.", "After Sanguine Retreat she has no exit: the void dodges the reply while it recharges."],
  ],
  "Focus Lens": [
    ["Calico", "Concentra bombas, corte e ultimate em poucos segundos: tudo cai dentro do silêncio.", "Packs bombs, slash and ultimate into a few seconds: all of it lands inside the silence."],
    ["Mina", "Combo curto de Rake, balas e Love Bites na janela; o alvo não usa habilidade para fugir.", "A short combo of Rake, bullets and Love Bites in the window; the target can't cast to escape."],
    ["Bebop", "Puxa com o Grapple Arm, silencia e a Sticky Bomb explode dentro da janela.", "Pulls with Grapple Arm, silences, and Sticky Bomb explodes inside the window."],
  ],
  "Lightning Scroll": [
    ["McGinnis", "O Heavy Barrage cobre área por segundos: cada inimigo atingido leva o atordoamento e fica nela.", "Heavy Barrage covers an area for seconds: each enemy hit is stunned and stays in it."],
    ["Seven", "O Storm Cloud cresce e acerta o grupo: atordoa todos e ajuda a não ser interrompido.", "Storm Cloud grows and hits the group: it stuns everyone and helps avoid interrupts."],
    ["Ivy", "A explosão do Air Drop já entra em área; o atordoamento encadeia com o Stone Form.", "Air Drop's explosion already hits an area; the stun chains into Stone Form."],
    ["Solomon", "Develop Queen atordoa, e o raio dá o segundo atordoamento logo depois.", "Develop Queen stuns, and the bolt adds a second stun right after."],
    ["Celeste", "Shining Wonder quica entre inimigos: cada um atingido leva o próprio raio.", "Shining Wonder bounces between enemies: each one hit takes its own bolt."],
  ],
  "Magic Carpet": [
    ["Sinclair", "Entra voando, larga o Assistente e transforma o grupo com o Rabbit Hex.", "Flies in, drops the Assistant and turns the group with Rabbit Hex."],
    ["Solomon", "Reposiciona pelo ar para mandar as peças do ângulo que precisa.", "Repositions through the air to send pieces from the angle he needs."],
    ["Lash", "Chegar pelo alto é o que Ground Strike e Death Slam pedem.", "Arriving from above is what Ground Strike and Death Slam want."],
    ["Viscous", "Chega voando e já sai rolando no Goo Ball para atordoar o grupo.", "Flies in and rolls straight into Goo Ball to stun the group."],
  ],
  "Mercurial Magnum": [
    ["Warden", "Usa a Alchemical Flask e descarrega a arma com cadência, dano de spirit e pente cheio.", "Throws Alchemical Flask, then unloads the gun with fire rate, spirit damage and a full magazine."],
    ["Wraith", "O Full Auto já dá cadência e dano de spirit: as balas carregadas saem muito mais rápido.", "Full Auto already adds fire rate and spirit damage: the charged bullets come out far faster."],
    ["Vyper", "Alterna dagas e rajadas: a Screwjab Dagger liga o bônus e a arma rápida gasta o pente.", "Alternates daggers and sprays: Screwjab Dagger turns on the bonus and her fast gun spends it."],
    ["Vindicta", "No Flight a arma já causa dano de spirit; o Magnum soma e recarrega no ar.", "In Flight her gun already deals spirit damage; Magnum adds to it and reloads mid-air."],
    ["Mina", "Bala com dano de spirit somado ao do Love Bites, e recarga de graça no meio da troca.", "Spirit bullets on top of Love Bites', and a free reload mid-trade."],
  ],
  "Mystic Reverb": [
    ["Paradox", "O tiro carregado do Kinetic Carbine é um golpe só e enorme: metade dele ecoa em volta.", "Kinetic Carbine's charged shot is one huge hit: half of it echoes around the target."],
    ["Grey Talon", "O Charged Shot acerta forte de longe, e o eco pega quem está perto do alvo.", "Charged Shot hits hard from range, and the echo catches anyone near the target."],
    ["Lady Geist", "A Essence Bomb custa vida e o Reverb devolve: cura e eco na habilidade principal.", "Essence Bomb costs health and Reverb gives it back: heal and echo on her main ability."],
    ["Lash", "Ground Strike do alto é dano único grande, e o eco acerta o grupo onde ele caiu.", "Ground Strike from height is one big hit, and the echo hits the group where he landed."],
    ["Yamato", "Power Slash carregado: cura, lentidão e eco no mesmo golpe.", "A charged Power Slash: heal, slow and echo in one hit."],
  ],
  Refresher: [
    ["Dynamo", "Dois Singularities seguidos: o grupo passa o dobro do tempo preso.", "Two Singularities in a row: the group is held for twice as long."],
    ["Lash", "Dois Death Slams na mesma luta, com Grapple e Ground Strike de volta.", "Two Death Slams in one fight, with Grapple and Ground Strike back too."],
    ["Yamato", "Segunda Shadow Transformation na mesma luta, com a invencibilidade inicial.", "A second Shadow Transformation in one fight, with its initial invincibility."],
    ["Seven", "Storm Cloud interrompido ou esquivado não é mais a única chance da luta.", "A Storm Cloud that was interrupted or dodged is no longer the only one."],
    ["Paige", "Dois Rallying Charges: duas ondas de cura e dano por todo o mapa.", "Two Rallying Charges: two waves of healing and damage across the map."],
  ],
  Scourge: [
    ["Mo & Krill", "Sai do Burrow colado no grupo e cura com Scorn enquanto a aura derrete em volta.", "Comes out of Burrow on top of the group and heals with Scorn while the aura melts them."],
    ["Calico", "Mergulha e se cura no Leaping Slash; a aura trabalha enquanto ela fica em cima.", "Dives and heals with Leaping Slash; the aura works while she stays on them."],
    ["Billy", "O Chain Gang prende os inimigos perto dele: ninguém sai da aura.", "Chain Gang ties enemies to him: no one leaves the aura."],
    ["Abrams", "Siphon Life já pede ficar perto; a aura soma dano e resistência a essa troca.", "Siphon Life already wants to be close; the aura adds damage and resist to that trade."],
    ["Victor", "Aura of Suffering e a aura do Scourge batem juntas em quem chega perto.", "Aura of Suffering and Scourge's aura hit anyone close together."],
  ],
  "Spirit Burn": [
    ["Pocket", "Barrage, Flying Cloak e Satchel em sequência passam dos 500 de dano dentro dos 5 s.", "Barrage, Flying Cloak and Satchel in sequence clear 500 damage within 5s."],
    ["Mina", "Rake, ultimate e mordidas no mesmo combo acendem a queimadura e cortam a cura do alvo.", "Rake, ultimate and bites in one combo light the burn and cut the target's healing."],
    ["Grey Talon", "Charged Shot e Guided Owl são golpes grandes: chegam ao limite com poucos acertos.", "Charged Shot and Guided Owl are big hits: few are needed to reach the threshold."],
    ["Lash", "O combo inteiro cai de uma vez em vários alvos, e cada um queima.", "His whole combo lands at once on several targets, and each one burns."],
    ["Lady Geist", "Malice aumenta o dano da Essence Bomb até o limite sair fácil.", "Malice raises Essence Bomb's damage until the threshold comes easily."],
  ],
  "Transcendent Cooldown": [
    ["Paige", "Plot Armor e Captivating Read mais vezes: barreira e controle em toda troca.", "Plot Armor and Captivating Read more often: a barrier and control in every trade."],
    ["Dynamo", "Quantum Entanglement e Aurora voltam na mesma luta, e a ultimate em mais lutas.", "Quantum Entanglement and Aurora return in the same fight, and the ultimate in more fights."],
    ["Pocket", "Cloak e Satchel mais frequentes: são o dano e também a fuga.", "Cloak and Satchel more often: they are both damage and escape."],
    ["Mo & Krill", "Burrow mais vezes é mais entrada, saída e Scorn.", "More frequent Burrows mean more entries, exits and Scorns."],
    ["The Doorman", "Luggage Cart e Call Bell mais vezes: cada puxão pode virar abate.", "Luggage Cart and Call Bell more often: every pull can become a kill."],
  ],
  "Vortex Web": [
    ["The Doorman", "O grupo amontoado fica na linha do Luggage Cart, que arrasta vários de uma vez.", "The bunched group sits in the line of Luggage Cart, which drags several at once."],
    ["Paige", "Captivating Read demora a detonar: o vórtice segura todos na área, e o Bookwyrm passa por cima.", "Captivating Read detonates late: the vortex holds everyone in it, and Bookwyrm runs over them."],
    ["Sinclair", "Rabbit Hex é em área: agrupados, viram coelho juntos e recebem mais dano.", "Rabbit Hex is an area: bunched up, they all turn into rabbits and take more damage."],
    ["Ivy", "Puxa todos para o lugar onde o Stone Form cai: atordoamento em grupo.", "Pulls everyone to where Stone Form lands: a group stun."],
    ["Solomon", "As casas diagonais do Bishop e as torres acertam melhor um grupo parado num ponto.", "The Bishop's diagonal squares and the rooks hit better against a group held in one spot."],
    ["Paradox", "A Pulse Grenade precisa que fiquem dentro: o vórtice segura o grupo para todos os pulsos.", "Pulse Grenade needs them inside: the vortex holds the group for every pulse."],
  ],
  // -------------------------------------------------------------- Vitality
  "Cheat Death": [
    ["The Doorman", "Os 4,5 s vivo bastam para um Doorway de fuga ou um Hotel Guest que inverte a luta.", "The 4.5s alive is enough for an escape Doorway or a Hotel Guest that turns the fight."],
    ["Pocket", "Mergulha no meio do grupo; a imunidade dá tempo de usar Satchel ou voltar pelo Cloak.", "Dives into the group; immunity buys time for Satchel or a Cloak out."],
    ["Wraith", "Project Mind durante a imunidade tira Wraith da luta em que morreria.", "Project Mind during immunity takes Wraith out of the fight they'd die in."],
    ["Lady Geist", "Com a vida no fim, Soul Exchange troca a vida dela com a do inimigo.", "At the end of her health, Soul Exchange swaps it with the enemy's."],
  ],
  Colossus: [
    ["Billy", "Chain Gang prende os inimigos dentro da aura lenta, e o bônus de melee entra no bastão.", "Chain Gang ties enemies inside the slow field, and the melee bonus goes into his bat."],
    ["Abrams", "Aguenta no meio do grupo com Siphon Life, e a lentidão mantém todos no alcance dele e dos socos.", "Survives in the group with Siphon Life, and the slow keeps them in range of it and his punches."],
    ["Rat King", "A barreira do Royal Pestments cresce com a vida máxima, e o Colossus dá 25% de vida base.", "Royal Pestments' barrier scales with max health, and Colossus gives 25% base health."],
    ["Yamato", "Chega com Flying Slash e a área lenta impede de sair enquanto o Power Slash carrega.", "Arrives with Flying Slash, and the slow field stops escapes while Power Slash charges."],
  ],
  "Divine Barrier": [
    ["Paige", "Soma com Plot Armor: duas barreiras no mesmo aliado, que bate mais enquanto ela durar.", "Adds to Plot Armor: two barriers on one ally, who hits harder while Plot Armor holds."],
    ["Rem", "Limpa e protege de longe quem ela vai curar com o Tag Along.", "Cleanses and shields from range the ally she's about to heal with Tag Along."],
    ["Solomon", "Protege o aliado promovido pelo Kingside Knight: ele entra com duas barreiras.", "Shields the ally promoted by Kingside Knight: they go in with two barriers."],
    ["The Doorman", "Salva de longe o aliado que entrou pelo Doorway ou que o Cart trouxe de volta.", "Saves from range the ally who went through the Doorway or was brought back by the Cart."],
  ],
  "Diviner's Kevlar": [
    ["Silver", "A Lycan Curse entra para brigar de perto: a barreira de 1000 paga a transformação.", "Lycan Curse goes in to brawl: the 1000 barrier pays for the transformation."],
    ["Sinclair", "Audience Participation traz muitas vezes uma ultimate que pede entrar na luta: a barreira protege.", "Audience Participation often copies an ultimate that must be used up close: the barrier protects."],
    ["Pocket", "Affliction é usada no meio do grupo: entra com barreira e mais Spirit Power no resto do combo.", "Affliction is cast inside the group: you get the barrier and more Spirit Power for the rest of the combo."],
    ["Deadman Danny", "Close The Deal o leva para longe do time: a barreira segura a resposta na queda.", "Close The Deal takes him away from the team: the barrier absorbs the reply on landing."],
    ["Yamato", "Shadow Transformation renova as habilidades: elas saem com +40 de Spirit Power e barreira.", "Shadow Transformation refreshes the abilities: they come out with +40 Spirit Power and a barrier."],
  ],
  "Healing Tempo": [
    ["Nurse Harrow", "Healing Needles cura a cada acerto: o aliado atira com a cadência ligada quase o tempo todo.", "Healing Needles heals on each hit: the ally shoots with the fire rate on almost permanently."],
    ["Rem", "Tag Along cura os dois e salta entre aliados: espalha cadência e velocidade.", "Tag Along heals both and hops between allies: it spreads fire rate and speed."],
    ["Ivy", "Kudzu replica a cura no aliado conectado, e os dois já são fortes de arma.", "Kudzu replicates healing to the linked ally, and Ivy's own gun uses the fire rate."],
    ["Kelvin", "Frost Grenade cura o grupo aliado em área: cadência para todos.", "Frost Grenade heals allies in an area: fire rate for everyone."],
    ["Dynamo", "Rejuvenating Aurora cura todos em volta durante o canal e mantém o buff.", "Rejuvenating Aurora heals everyone around during the channel and holds the buff."],
  ],
  Indomitable: [
    ["Deadman Danny", "Voar com o Chimera depende de não ser parado: o primeiro controle é limpo.", "Flying with Chimera depends on not being stopped: the first control is cleansed."],
    ["Seven", "Storm Cloud canalizado é o alvo óbvio de um atordoamento: o primeiro é limpo.", "A channeled Storm Cloud is the obvious stun target: the first one is cleansed."],
    ["Mina", "Entra para o combo curto; sem o primeiro controle ela ainda sai com Sanguine Retreat.", "Goes in for a short combo; with the first control gone she can still Sanguine Retreat."],
    ["Billy", "Toma controle por entrar primeiro: a limpeza e a recarga devolvem Rising Ram e Bashdown.", "Takes control by going first: the cleanse and cooldown refund give back Rising Ram and Bashdown."],
  ],
  Infuser: [
    ["Victor", "Aura of Suffering também fere Victor: o lifesteal alto cura mais que o custo enquanto há alvos.", "Aura of Suffering hurts Victor too: the high lifesteal outheals the cost while there are targets."],
    ["Seven", "Storm Cloud acertando o time inteiro cura por todos ao mesmo tempo.", "Storm Cloud hitting the whole team heals off all of them at once."],
    ["Kelvin", "O Arctic Beam sustentado transforma os 7 s inteiros em cura.", "A sustained Arctic Beam turns the full 7s into healing."],
    ["Lady Geist", "Bomba e Malice custam vida; nesta janela o dano delas devolve mais.", "Bomb and Malice cost health; in this window their damage gives back more."],
    ["Shiv", "Deferir dano com Bloodletting e curar por cima dele nos 7 s.", "Defer damage with Bloodletting and heal over it in the 7s."],
  ],
  Inhibitor: [
    ["Mirage", "Arma rápida no mesmo alvo, que já acumula Djinn's Mark; Fire Scarabs também corta o dano dele.", "Sustained fire on one target already stacks Djinn's Mark; Fire Scarabs cuts their damage too."],
    ["Haze", "Fixation pede tiros seguidos no mesmo alvo, e o Bullet Dance espalha o acúmulo no grupo.", "Fixation wants sustained fire on one target, and Bullet Dance spreads the buildup over a group."],
    ["Venator", "A granada já reduz cura; o Inhibitor completa contra quem vive de sustento.", "The grenade already reduces healing; Inhibitor completes it against sustain."],
    ["Silver", "Slam Fire recarrega na hora e dá cadência: termina o acúmulo sem pausa.", "Slam Fire reloads instantly and adds fire rate: it finishes the buildup without a pause."],
  ],
  Juggernaut: [
    ["Rat King", "Entra andando para usar o Rat Swarm de perto; a armadura desvia e o Juggernaut atrasa quem atira.", "Walks in to use Rat Swarm up close; the armor deflects and Juggernaut slows shooters."],
    ["Warden", "Precisa ficar perto para Binding Word e Last Stand: corre, regenera e aguenta tiro.", "Must stay close for Binding Word and Last Stand: runs, regenerates and takes fire."],
    ["Victor", "Aura of Suffering pede colar no alvo; a velocidade chega e a regeneração paga o autodano.", "Aura of Suffering wants to stick to a target; the speed gets there and the regen offsets self-damage."],
    ["Mo & Krill", "Sair do Burrow rápido e aguentar bala enquanto segura o alvo no Combo.", "Comes out of Burrow fast and tanks bullets while holding a target in Combo."],
    ["Billy", "Corpo a corpo sem fuga fácil: velocidade para chegar, menos tiro recebido.", "A melee fighter with no easy exit: speed to arrive, fewer bullets taken."],
  ],
  Leech: [
    ["Lady Geist", "Gasta a própria vida em bomba e Malice: precisa curar pelo dano das duas fontes.", "Spends her own health on bomb and Malice: needs to heal off both damage types."],
    ["Wraith", "Arma forte com spirit do Full Auto e das cartas: os dois lifesteals contam.", "A strong gun plus spirit from Full Auto and cards: both lifesteals count."],
    ["Infernus", "A bala cura como arma, e o Afterburn que ela acumula cura como spirit.", "Bullets heal as weapon, and the Afterburn they build heals as spirit."],
    ["Vyper", "Alterna dagas e rajadas, então usa os dois tipos de cura na mesma troca.", "Alternates daggers and sprays, so both heals work in the same trade."],
    ["Seven", "Power Surge faz a arma causar também choques de spirit: as duas curas por tiro.", "Power Surge makes the gun deal spirit shocks too: both heals per shot."],
  ],
  "Phantom Strike": [
    ["Abrams", "Cai em cima do alvo, usa o Shoulder Charge para prendê-lo na parede e termina no soco.", "Drops onto the target, pins it to a wall with Shoulder Charge and finishes with punches."],
    ["Mo & Krill", "Puxa o alvo para o chão e o Combo vem em seguida: fica preso nos dois.", "Pulls the target to the ground and follows with Combo: held through both."],
    ["Silver", "Na forma de lobo o problema é alcançar: teleporta e continua a briga de perto.", "In wolf form the problem is reaching: teleport and keep brawling."],
    ["Viscous", "Chega e o alvo lento não sai do Puddle Punch nem dos melees.", "Arrives, and the slowed target can't leave Puddle Punch or his melees."],
  ],
  "Plated Armor": [
    ["Shiv", "Mergulha em atiradores; menos bala entrando deixa menos dano adiado pelo Bloodletting.", "Dives gunners; fewer bullets landing means less damage deferred by Bloodletting."],
    ["Abrams", "Precisa atravessar o tiroteio até o soco, e a regeneração dele cuida do que passou.", "Must cross gunfire to reach his punch, and his regen handles what gets through."],
    ["Rat King", "Royal Pestments já desvia bala: duas chances diferentes contra o mesmo atirador.", "Royal Pestments already deflects bullets: two separate chances against the same gunner."],
    ["Billy", "Luta no corpo a corpo contra armas: barra também os efeitos de bala.", "Melee versus guns: it blocks on-hit effects too."],
  ],
  "Siphon Bullets": [
    ["Rat King", "A vida máxima roubada aumenta a barreira do Royal Pestments.", "Stolen max health raises the Royal Pestments barrier."],
    ["Venator", "Os três tiros da Ira Domini e a execução ficam mais fáceis em quem já tem menos vida máxima.", "Ira Domini's stakes and execute come easier on targets with less max health."],
    ["Graves", "Essence Theft já rouba pela arma em trocas longas: rouba dano, resistência e agora vida.", "Essence Theft already steals through the gun in long trades: damage, resist and now health."],
    ["Haze", "Bullet Dance atira em todos ao redor: rouba vida de vários no momento em que ela mais apanha.", "Bullet Dance shoots everyone around: it steals from several when she is most exposed."],
    ["Ivy", "Stone Form cura por % da vida máxima: a vida roubada aumenta a cura.", "Stone Form heals a % of max health: stolen health raises the heal."],
  ],
  Spellbreaker: [
    ["Abrams", "Entra primeiro e recebe o combo de magia: corta o golpe grande, e o Siphon Life recupera o resto.", "Goes first and takes the spell combo: the big hit is cut, and Siphon Life recovers the rest."],
    ["Silver", "Na Lycan Curse ele briga colado e vira alvo das magias do time inteiro.", "In Lycan Curse they brawl up close and draw the whole team's spells."],
    ["Shiv", "O golpe grande chega menor e o Bloodletting adia o que sobrou.", "The big hit arrives smaller and Bloodletting defers what's left."],
    ["Billy", "Atravessa habilidades para chegar com Rising Ram; ganha resistência a debuff no caminho.", "Runs through abilities to arrive with Rising Ram; gains debuff resist on the way."],
  ],
  Unstoppable: [
    ["Seven", "Ative antes do Storm Cloud: ninguém interrompe o canal com atordoamento.", "Use before Storm Cloud: no one interrupts the channel with a stun."],
    ["Dynamo", "Garante o Singularity inteiro, que qualquer atordoamento cancelaria.", "Guarantees the full Singularity, which any stun would cancel."],
    ["Silver", "A Lycan Curse dura pouco: sem controle, todo o tempo dela vira dano.", "Lycan Curse is short: without control, all of it becomes damage."],
    ["Haze", "Bullet Dance no meio do grupo sem ser atordoada ou desarmada.", "Bullet Dance inside the group without being stunned or disarmed."],
    ["Lash", "O Death Slam precisa de foco nos alvos: imune a controle, ele termina.", "Death Slam needs focus time on targets: immune to control, it completes."],
  ],
  "Vampiric Burst": [
    ["Venator", "Recarrega o pente e cura na rajada de perto depois do Gutshot.", "Refills the magazine and heals in the close-range burst after Gutshot."],
    ["Haze", "Bullet Dance atira em todos ao redor: cada bala cura, com mais cadência.", "Bullet Dance shoots everyone around: every bullet heals, with more fire rate."],
    ["Vyper", "Cadência muito alta gasta o pente rápido: o item devolve munição e cura.", "Very high fire rate empties the magazine: the item gives back ammo and heals."],
    ["Vindicta", "No Flight ela é alvo fácil: cura alta e munição sem precisar pousar.", "In Flight she's an easy target: high healing and ammo without landing."],
    ["Drifter", "Isola um alvo e troca de perto: o dano de arma vira vida no duelo.", "Isolates a target and trades up close: weapon damage becomes health in the duel."],
  ],
  Witchmail: [
    ["Celeste", "Troca magia de perto com Light Eater e Dazzling Trick; cada golpe recebido devolve recarga.", "Trades spells with Light Eater and Dazzling Trick; every hit taken returns cooldown."],
    ["Bebop", "Recargas longas (Grapple Arm, Hyper Beam): 4 s por golpe podem trazer o gancho de volta.", "Long cooldowns (Grapple Arm, Hyper Beam): 4s per hit can bring the hook back."],
    ["Mo & Krill", "Fica no meio da luta recebendo magia: Scorn e Burrow voltam antes.", "Sits in the fight eating spells: Scorn and Burrow return sooner."],
    ["Rat King", "Linha de frente: os golpes de spirit que a armadura não desvia devolvem recarga.", "Front line: the spirit hits that armor can't deflect refund cooldowns."],
    ["Abrams", "Entra primeiro e toma o combo: Siphon Life e Shoulder Charge voltam na mesma luta.", "Goes first and takes the combo: Siphon Life and Shoulder Charge return in the same fight."],
  ],
  // ---------------------------------------------------------------- Weapon
  "Armor Piercer": [
    ["Haze", "Muitas balas e Fixation no mesmo alvo: fura o tanque que segurava a carry.", "Many bullets and Fixation on one target: pierces the tank that used to stop her."],
    ["Venator", "Ira Domini e tiros fortes de perto perdem muito para resistência; aqui, menos.", "Ira Domini and strong close shots lose a lot to resist; here, less."],
    ["Vyper", "Cadência alta: 60% de chance em muitas balas vira ignorar a resistência quase sempre.", "High fire rate: 60% over many bullets means resist is mostly ignored."],
    ["Vindicta", "De longe e do alto: balas mais rápidas e impossíveis de evitar.", "From range and above: faster bullets that can't be avoided."],
  ],
  Capacitor: [
    ["Ivy", "Cadência alta de arma espalha choques; o ativo prende quem ela quer segurar com Entangling Thorns.", "A fast gun spreads shocks; the active pins targets for Entangling Thorns."],
    ["Wraith", "Full Auto multiplica as chances de choque, e o ativo prende o alvo para o Telekinesis.", "Full Auto multiplies shock chances, and the active pins a target for Telekinesis."],
    ["Haze", "Bullet Dance em grupo é muita bala em muitos alvos: choques em cadeia o tempo todo.", "Bullet Dance in a group is many bullets on many targets: constant chains."],
    ["Graves", "Os Deadheads grudam em quem não consegue correr: o ativo tira stamina e mobilidade do alvo.", "Deadheads stick to anyone who can't run: the active removes stamina and mobility."],
    ["Vyper", "Muitas balas por segundo são muitas chances de choque, e o alvo preso leva as dagas.", "Many bullets per second are many shock rolls, and the pinned target eats daggers."],
  ],
  "Crippling Headshot": [
    ["Paradox", "O Kinetic Carbine é spirit que cresce com arma: aproveita as duas resistências reduzidas.", "Kinetic Carbine is spirit damage that scales with weapon: it uses both reduced resists."],
    ["Holliday", "Crackshot já recompensa headshot; o debuff abre o alvo para barris e para o time.", "Crackshot already rewards headshots; the debuff opens the target for barrels and the team."],
    ["Haze", "Headshot dá três stacks de Fixation: o mesmo tiro aumenta o dano e reduz a resistência.", "A headshot gives three Fixation stacks: the same shot raises damage and cuts resist."],
    ["Vindicta", "Mira de longe; a bala com spirit do Flight também usa a redução de Spirit Resist.", "Aims from range; Flight's spirit bullets also use the Spirit Resist cut."],
    ["Venator", "Corta mais cura que a granada sozinha e prepara a Ira Domini.", "Cuts more healing than the grenade alone and sets up Ira Domini."],
  ],
  "Crushing Fists": [
    ["Abrams", "Shoulder Charge na parede atordoa: o soco pesado seguinte é garantido e já empilha.", "Shoulder Charge into a wall stuns: the next heavy punch is guaranteed and stacks."],
    ["Billy", "Blasted já premia melee com munição; o Bashdown mantém o alvo no alcance do bastão.", "Blasted already rewards melee with ammo; Bashdown keeps targets in bat range."],
    ["Viscous", "Puddle Punch levanta e deixa lento: o melee seguinte conecta e empilha.", "Puddle Punch launches and slows: the next melee connects and stacks."],
    ["Drifter", "Rend de perto soma dano de melee, e ele já chega colado pelo Stalker's Mark.", "Close Rend adds melee damage, and Stalker's Mark puts him right there."],
    ["Calico", "Leaping Slash é dano de melee e a coloca em cima do alvo para os socos.", "Leaping Slash is melee damage and puts her on target for punches."],
  ],
  Frenzy: [
    ["Silver", "Bloodlust cresce mais com vida baixa: a mesma faixa liga o Frenzy e acelera a Lycan Curse.", "Bloodlust builds more at low health: the same range turns on Frenzy and speeds up Lycan Curse."],
    ["Rat King", "A barreira segura enquanto ele fica abaixo de 50% com o bônus ligado.", "The barrier holds while staying under 50% with the bonus on."],
    ["Drifter", "Duelo de perto com muita troca: ganha cadência e velocidade na virada.", "Close duels with heavy trading: gains fire rate and speed on the turn."],
    ["Billy", "Entra primeiro e apanha: a resistência a debuff e a velocidade deixam continuar em cima.", "Goes first and takes hits: debuff resist and speed let him stay on top."],
  ],
  "Glass Cannon": [
    ["Paradox", "O Kinetic Carbine cresce com dano de arma, e Time Wall e Swap compensam a vida menor.", "Kinetic Carbine scales with weapon damage, and Time Wall and Swap offset the lower health."],
    ["Holliday", "Tiro forte de longe com Crackshot, e o Bounce Pad tira Holliday de perto.", "A strong long-range gun with Crackshot, and Bounce Pad gets Holliday away."],
    ["Vindicta", "Luta voando e de longe: a vida perdida pesa menos, e Assassinate fecha abates para os stacks.", "Fights flying and from range: lost health matters less, and Assassinate secures kills for stacks."],
    ["Drifter", "Escolhe alvo isolado: mata antes da resposta e guarda os stacks de abate.", "Picks isolated targets: kills before the reply and banks the kill stacks."],
    ["Vyper", "Dano de arma alto numa arma já rápida; Petrifying Bola dá a saída.", "High weapon damage on an already fast gun; Petrifying Bola gives the exit."],
  ],
  "Lucky Shot": [
    ["Haze", "Fixation aumenta o dano da bala, e a sorte é rolada em muitas delas.", "Fixation raises bullet damage, and luck is rolled on many of them."],
    ["Shiv", "Build de arma de perto: poucos tiros fortes que dobram às vezes.", "A close-range gun build: few strong shots that sometimes double."],
    ["Holliday", "Balas de dano alto: cada tiro com sorte vale muito.", "High-damage bullets: each lucky shot is worth a lot."],
    ["Drifter", "Dano de arma alto contra alvo isolado, que o Bloodscent já amplifica.", "High weapon damage on an isolated target, already amplified by Bloodscent."],
    ["Vyper", "Muitas balas por segundo são muitas chances de sorte.", "Many bullets per second are many rolls."],
  ],
  Ricochet: [
    ["Mirage", "Djinn's Mark é aplicado pela arma: com o ricochete, em vários alvos de uma vez.", "Djinn's Mark is applied by the gun: with ricochet, on several targets at once."],
    ["Haze", "Bullet Dance já atira em todos: cada bala ainda salta para os vizinhos.", "Bullet Dance already shoots everyone: each bullet also jumps to neighbours."],
    ["Wraith", "O dano de arma gera cartas: mais alvos por tiro são mais cartas.", "Weapon damage generates cards: more targets per shot means more cards."],
    ["Nurse Harrow", "Pelas builds publicadas, o salto leva também a cura do Healing Needles a aliados próximos.", "According to published builds, the bounce also carries Healing Needles' heal to nearby allies."],
    ["Infernus", "Afterburn acumula por bala: o ricochete põe fogo em mais gente.", "Afterburn builds per bullet: ricochet sets more people on fire."],
  ],
  Silencer: [
    ["Haze", "Cadência alta e tiros seguidos no mesmo alvo por causa do Fixation: silencia rápido.", "High fire rate and sustained fire on one target for Fixation: silences quickly."],
    ["Venator", "Snap Trap imobiliza e dá o tempo de tiro para completar o silêncio.", "Snap Trap immobilizes and buys the firing time to finish the silence."],
    ["Vyper", "Uma das armas mais rápidas: o silêncio sai numa rajada.", "One of the fastest guns: the silence lands in one spray."],
    ["Drifter", "Alvo isolado e silenciado não tem como pedir distância no duelo.", "An isolated, silenced target has no way to make distance in the duel."],
    ["Mirage", "Mantém fogo no alvo marcado; o silêncio impede a fuga antes de consumir as marcas.", "Keeps fire on the marked target; silence stops the escape before the marks are consumed."],
  ],
  Spellslinger: [
    ["Vindicta", "Stake, Flight e Crow antes de atirar: três stacks prontos e uma arma que bate do alto.", "Stake, Flight and Crow before shooting: three stacks ready and a gun firing from above."],
    ["Celeste", "Os tiros detonam a luz do Light Eater, e as habilidades que dão stack saem em sequência.", "Her shots detonate Light Eater's light, and the abilities that stack come in sequence."],
    ["Warden", "Flask, Willpower e Binding Word são usados antes da rajada: todos dão stack.", "Flask, Willpower and Binding Word come before the barrage: each gives a stack."],
    ["Rat King", "Granada, Swarm e Pestments na entrada já ligam a cadência para o tiroteio.", "Grenade, Swarm and Pestments on entry turn on the fire rate for the gunfight."],
    ["Wraith", "Card Trick é lançado muitas vezes, e a cadência gera mais cartas.", "Card Trick is thrown often, and the fire rate generates more cards."],
  ],
  "Spiritual Overflow": [
    ["Warden", "Carrega atirando e usa o Spirit Power no Last Stand, que cura pelo dano.", "Charges by shooting and spends the Spirit Power on Last Stand, which heals off its damage."],
    ["Infernus", "A bala que carrega o Overflow é a mesma que acumula Afterburn, e o Spirit Power aumenta o fogo.", "The bullets that charge Overflow also build Afterburn, and the Spirit Power raises the burn."],
    ["Wraith", "Arma para carregar, cartas e Full Auto para gastar o Spirit Power.", "A gun to charge it, cards and Full Auto to spend the Spirit Power."],
    ["Celeste", "Light Eater faz os tiros causarem spirit e curarem: usa os três bônus do item.", "Light Eater makes shots deal spirit damage and heal: uses all three of the item's bonuses."],
    ["Mirage", "Tiro no mesmo alvo carrega o item e acumula Djinn's Mark, que é dano de spirit.", "Sustained fire charges the item and stacks Djinn's Mark, which is spirit damage."],
  ],
};

export interface HeroUse {
  hero: Hero;
  /** Motivo pelo kit, se analisado. */
  reason: string | null;
  /** Fração das partidas do herói em que o item é comprado. */
  rate: number | null;
  /** Vezes a média de todos os heróis. */
  lift: number | null;
}

/** Compra mínima, e vezes a média, para um herói sem análise entrar só pelos números. */
const MIN_RATE = 0.08;
const MIN_LIFT = 1.5;

/** Heróis para um item: primeiro os com motivo pelo kit, depois quem compra muito acima da média. */
export function heroesFor(data: GameData, item: Item, limit = 8): HeroUse[] {
  const usage = data.heroes.map((hero) => {
    const meta = heroMeta(data, hero.id);
    return { hero, matches: meta?.matches ?? 0, bought: meta?.items[item.className]?.matches ?? 0 };
  });
  const total = usage.reduce((s, u) => s + u.matches, 0);
  const average = total > 0 ? usage.reduce((s, u) => s + u.bought, 0) / total : 0;
  const rows = new Map((HERO_COMBOS[item.name] ?? []).map(([hero, pt, en]) => [hero, tr(pt, en)]));
  const all = usage.map(({ hero, matches, bought }): HeroUse => {
    const rate = matches > 0 ? bought / matches : null;
    return { hero, reason: rows.get(hero.name) ?? null, rate, lift: rate !== null && average > 0 ? rate / average : null };
  });
  return all
    .filter((u) => u.reason || ((u.rate ?? 0) >= MIN_RATE && (u.lift ?? 0) >= MIN_LIFT))
    .sort((a, b) => Number(!!b.reason) - Number(!!a.reason) || (b.rate ?? 0) - (a.rate ?? 0))
    .slice(0, limit);
}
