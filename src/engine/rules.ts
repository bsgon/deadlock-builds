/**
 * Regras que NÃO vêm da API e foram escritas à mão.
 * Cada item de ASSUMPTIONS é uma hipótese do motor que ainda precisa ser
 * conferida dentro do jogo; mude aqui e os testes mostram o impacto.
 */

/** Custo em pontos de habilidade dos upgrades T1, T2 e T3. */
export const ABILITY_UPGRADE_COST = [1, 2, 5] as const;

/** Slots de item: 9 iniciais, até 12 com os Walkers inimigos destruídos. */
export const BASE_ITEM_SLOTS = 9;
export const MAX_ITEM_SLOTS = 12;

/** Máximo de itens ativos equipados. */
export const MAX_ACTIVE_ITEMS = 4;

/** Fração do preço devolvida ao vender um item. */
export const SELL_REFUND = 0.5;

/**
 * Pico de vitality: com 4.800 souls investidos na árvore, o bônus de vida base
 * pula de 20% para 38%, o maior salto da tabela. As builds devem chegar a ele
 * antes do mid game.
 */
export const VITALITY_SPIKE_SOULS = 4800;

/** Minuto em que o mid game começa (prazo para o pico de vitality). */
export const MID_GAME_MINUTE = 15;

export interface Assumption {
  id: string;
  rule: string;
  source: string;
}

export const ASSUMPTIONS: Assumption[] = [
  {
    id: "ability-upgrade-cost",
    rule: "Upgrades de habilidade custam 1, 2 e 5 pontos (T1, T2, T3).",
    source: "Conhecimento da comunidade; bate com os 32 pontos que a API distribui (4 habilidades x 8).",
  },
  {
    id: "resist-stacking",
    rule: "Resistências de fontes diferentes empilham multiplicativamente: 1 - Π(1 - Ri). A redução (shred) empilha do mesmo jeito e é subtraída depois.",
    source: "deadlock.wiki/Damage_Resistance e deadlockhandbook.com (mesma fórmula nas duas).",
  },
  {
    id: "weapon-damage-additive",
    rule: "Bônus de dano de arma (%) de itens e do investimento em Weapon somam entre si e multiplicam o dano base da bala (base + ganho por boon).",
    source: "Hipótese do motor; não confirmada em fonte atual.",
  },
  {
    id: "vitality-investment-base-health",
    rule: "O bônus de investimento em Vitality é % sobre a vida base (inicial + ganho por boon), sem afetar vida vinda de itens.",
    source: "Hipótese do motor; a API só dá o número do bônus, não a que ele se aplica.",
  },
  {
    id: "cooldown-additive",
    rule: "Redução de cooldown de itens diferentes soma (aditiva) e é limitada a 100%.",
    source: "Hipótese do motor; não confirmada em fonte atual.",
  },
  {
    id: "fire-rate-scales-shots",
    rule: "Cadência de tiro (%) multiplica os tiros por segundo da arma, inclusive em armas de rajada.",
    source: "Hipótese do motor; em armas de rajada o intervalo entre rajadas pode escalar diferente.",
  },
  {
    id: "single-bullet-reload",
    rule: "Armas que recarregam bala a bala levam atraso inicial + (balas do pente x tempo por bala).",
    source: "Derivado dos campos reload_single_bullets* da API; a própria API calcula um valor diferente.",
  },
  {
    id: "coef-is-spirit",
    rule: "Coeficiente de escala sem stat de poder declarado (só cooldown, duração, alcance...) é tratado como 'por Spirit Power'.",
    source: "Hipótese do motor a partir do padrão dos dados da API.",
  },
  {
    id: "conditional-excluded",
    rule: "Stats de itens que dependem de condição, proc ou ativação não entram no cálculo base; só os da seção 'innate' do item.",
    source: "Decisão de escopo da Fase 1; as condições serão modeladas na Fase 2.",
  },
  {
    id: "target-health",
    rule: "Efeitos em % da vida máxima do alvo (ex.: Toxic Bullets) usam um alvo de 2.500 de vida, e o sangramento acumulado fica ativo pela duração a cada barra cheia enquanto a arma atira.",
    source: "Escolha de projeto: vida aproximada de um herói no mid game, sem modelar o inimigo.",
  },
  {
    id: "mid-game-minute",
    rule: "O mid game começa aos 15 minutos; o prazo do pico de vitality são os souls médios do herói nesse minuto.",
    source: "Escolha de projeto. Pelas estatísticas, jogadores chegam a 4,8k em vitality por volta dos 19 a 26 minutos.",
  },
];
