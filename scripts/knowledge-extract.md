# Extração de interações (instruções para o extrator)

Entrada: `batch-N.json`, uma lista de trechos da wiki de Deadlock. Cada trecho tem
`owner` (o item, habilidade ou herói dono da página/seção), `mentions` (entidades
citadas no trecho, com `id`, `name`, `kind`), `text`, `url`, `heading` e `lead`
(a frase de abertura da seção). Linhas de tabela e itens de lista só fazem
sentido com o `lead`: por exemplo, na seção "Affected Abilities" de Spirit Snatch,
o `lead` diz que habilidades que causam dano de melee disparam o efeito, e cada
linha da tabela é uma dessas habilidades.

Saída: `result-N.json`, um array JSON de interações:

```json
{
  "a": "<id do owner ou de uma mention>",
  "b": "<id de outra entidade do mesmo trecho>",
  "relation": "synergy" | "anti",
  "strength": 1 | 2 | 3,
  "mechanism": "<como funciona, em português do Brasil, com suas palavras, até 25 palavras>",
  "source": { "url": "<url do trecho>", "heading": "<heading do trecho>" }
}
```

## O que conta como interação

Registre só quando uma entidade muda **como a outra funciona**:

- dispara, aplica ou ativa o efeito da outra (ex.: habilidade que conta como dano
  de melee e ativa Spirit Snatch; habilidade que ativa um item "ao lançar");
- escala de um jeito específico com a outra (ex.: Arcane Surge dá duração e
  alcance extras à habilidade X; "Perfect Abilities" de um item);
- combina a ponto de mudar a build (combo conhecido, reset de cooldown, efeito que
  dura mais com a outra);
- **anti**: não funciona com a outra, não dispara, é anulada, tem bug, ou atrapalha.

Só interações **dentro da build de um mesmo jogador** (os itens e as habilidades
dele). Não registre:

- contra-jogo contra o inimigo: listas de efeitos que um item remove, reduz ou
  bloqueia quando vêm do inimigo (Dispel Magic, Cursed Relic, Debuff Reducer,
  Healbane contra curas do inimigo, Unstoppable...);

- linhas de loja (componente, preço, tier, "upgrades from");
- simples citação sem mecanismo ("o herói X costuma comprar Y");
- empilhar o mesmo stat (dois itens que dão Spirit Power);
- listas de mudanças de patch sem efeito atual.

## Força

- 1: detalhe útil, vale saber (ex.: o item afeta a habilidade com um bônus pequeno);
- 2: combinação forte e específica (ex.: a habilidade dispara o efeito do item a cada uso);
- 3: combinação que define a build ou um anti que inutiliza o item.

## Regras

- Use apenas ids que aparecem no próprio trecho (`owner.id` ou `mentions[].id`).
- Uma interação por par e por trecho; se o trecho cita várias habilidades que
  funcionam com o item, crie uma interação para cada (item, habilidade).
- Escreva `mechanism` com suas palavras, em português do Brasil. Não copie frases
  da wiki. Nomes de itens e habilidades ficam em inglês.
- Na dúvida se é interação real, não registre.
- Grave só o JSON, sem comentários.
