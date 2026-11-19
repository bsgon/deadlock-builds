/**
 * Correções manuais da etiquetagem automática, por nome do item ou habilidade.
 * Use quando o texto do jogo engana as regras de tagger.ts ou quando um efeito
 * não aparece nos dados. Cada entrada deve dizer por quê.
 */
import type { Damage, Debuff, Stat, Trigger, When } from "./tags.ts";

export interface Override {
  why: string;
  add?: {
    gives?: Partial<Record<Stat, When>>;
    wants?: Partial<Record<Stat, number>>;
    applies?: Debuff[];
    deals?: Damage[];
    triggers?: Trigger[];
  };
  remove?: {
    gives?: Stat[];
    wants?: Stat[];
    applies?: Debuff[];
    deals?: Damage[];
    triggers?: Trigger[];
  };
}

export const OVERRIDES: Record<string, Override> = {
  "Cheat Death": {
    why: "A cura reduzida é penalidade em quem usa o item, não debuff no inimigo.",
    remove: { applies: ["antiHeal"] },
  },
  Infuser: {
    why: "O item só dá buffs a quem ativa; a etiqueta de enfraquecer inimigo era falso positivo.",
    remove: { applies: ["weaken"] },
  },
  "Glass Cannon": {
    why: "Não aplica lentidão; falso positivo da etiquetagem automática.",
    remove: { applies: ["slow"] },
  },
  "Reactive Barrier": {
    why: "A barreira dispara ao sofrer controle; o texto não usa as palavras do gatilho de dano recebido.",
    add: { triggers: ["takingDamage"] },
  },
};
