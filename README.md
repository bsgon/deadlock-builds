# Deadlock Builds

Construtor de builds de Deadlock: monta a ordem de compra de itens por herói, explica por que cada compra vale naquele momento e confere as escolhas com o winrate das partidas.

**App:** https://bsgon.github.io/deadlock-builds/

## Como funciona

- Dados do jogo e estatísticas de partidas vêm do [deadlock-api.com](https://deadlock-api.com) e ficam em `data/snapshot/`.
- O motor (`src/engine/`) calcula stats, dano e defesa da build; o otimizador (`src/optimizer/`) escolhe as compras por ganho por soul.
- `src/combat/` simula as jogadas (combos de habilidades e itens) em vários tipos de luta.
- `src/meta/` compara cada compra com o que os jogadores do herói compram no mesmo momento da partida e mede a duração e o tamanho das lutas nas partidas reais.
- `src/optimizer/amplify.ts` modela vulnerabilidade (Malice, Napalm, Escalating Exposure...).

## Comandos

```bash
npm install
npm run dev          # app local
npm run check        # typecheck + testes
npm run build-for -- Paige --objective control   # build pelo terminal
npm run artifact     # página única em dist-artifact/index.html
npm run update       # atualiza os dados depois de um patch
npm run fights       # mede duração e tamanho das lutas em partidas recentes
```

Requer Node 22.18 ou mais novo.

A cada push na `main`, o GitHub Actions gera a página e publica no GitHub Pages.
