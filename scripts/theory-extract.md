# Extração de theorycraft (instruções para o extrator)

Entrada: `batch-N.json`, lista de builds publicadas no jogo Deadlock, todas do patch
atual. Cada uma tem `hero`, `buildId`, `favorites` e `doc`: o nome da build, a
descrição do autor (qualquer língua) e as categorias com os itens. Em cada item
pode haver:

- `— "texto"`: anotação do autor sobre aquele item (ex.: "vs tanks", "rush this");
- `[vender: prioridade N]`: o autor marcou o item para vender mais tarde (número
  menor = vende primeiro). É a pista das trocas de fim de jogo.

As categorias também dizem muito: "Early", "Core", "Late", "Situational",
"Counter", "Defensives", "Actives", "#Citadel_HeroBuilds_EarlyGame/MidGame/LateGame".

Saída: `result-N.json`, um array JSON de teorias:

```json
{
  "hero": "<nome do herói>",
  "kind": "archetype" | "combo" | "timing" | "late-swap" | "situational",
  "items": ["<nome exato do item>", "..."],
  "title": "<título curto em pt-BR, até 8 palavras>",
  "claim": "<a ideia, em pt-BR, com suas palavras, até 30 palavras>",
  "condition": "<só em situational: quando vale, em pt-BR>",
  "builds": [<buildId>, ...],
  "favorites": <soma dos favoritos dessas builds>
}
```

## Tipos

- **archetype**: um estilo de jogo do herói e os 3 a 6 itens que o definem (ex.:
  "Abrams de arma, curta distância": Close Quarters, Point Blank, Crushing Fists).
  Registre um por estilo distinto que aparecer em várias builds do herói.
- **combo**: 2 ou 3 itens que o autor junta por um motivo (um dispara o outro,
  um cobre a fraqueza do outro). Só com motivo explícito ou muito claro.
- **timing**: um item que o autor manda priorizar ou comprar cedo/tarde, e por quê
  (ex.: "rush Spirit Snatch").
- **late-swap**: item que é vendido no fim (`[vender]`, ou categoria Early cujo item
  some na Late) e o que entra no lugar. `items` = [vendido, comprado].
- **situational**: item para uma situação (ex.: "Healbane contra heróis de cura",
  "Unstoppable contra muito controle"). Preencha `condition`.

## Regras

- Use nomes de itens exatamente como aparecem no `doc`.
- Junte o que várias builds do mesmo herói dizem numa só teoria e liste todos os
  `buildId` que a sustentam: o apoio importa mais que a frase de um autor.
- Prefira teorias que aparecem em 2 ou mais builds; aceite de uma só build quando
  a anotação ou descrição for específica e convincente.
- Não registre o óbvio sem motivo (ex.: "compre itens de dano").
- Escreva `title`, `claim` e `condition` em português do Brasil, com suas palavras.
  Não copie frases dos autores. Nomes de itens e heróis ficam em inglês.
- Grave só o JSON, sem comentários.
