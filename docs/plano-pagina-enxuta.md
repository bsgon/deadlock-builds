# Plano: página enxuta e ordem de compra revista

Escrito em 24/11/2026. Nada foi implementado ainda. Um commit por batch.

## 1. O que medi

**Página** (Infernus, Otimizada, 1400 px): 9.906 px de altura e 19 mil caracteres.

| Seção | Altura | Caracteres |
|---|---|---|
| Ordem de compra | 5.669 px | 10.114 |
| Teorias da comunidade | 2.036 px | 3.991 |
| Jogadas da build | 700 px | 951 |
| Comparado com as mais jogadas / elo alto | 1.063 px | 2.090 |
| O que a build muda | 482 px | 294 |
| Upgrades de habilidade | 468 px | 278 |

**Ordem de compra.** App: 6 heróis (Paige, Infernus, Haze, Abrams, Seven, Vindicta), Otimizada, 50 mil souls.
Jogadores: 9.980 partidas de `data/raw/wpa` (todos os heróis, todos os elos).

| | Jogadores | App |
|---|---|---|
| Primeiro T2 | mediana 6,0 min (25% até 4,6) | 5,5 a 10 min |
| Primeiro T3 | mediana 12,7 min (25% até 10,3) | 14 a 21 min |
| Primeiro T4 | mediana 24,3 min (25% até 20,9) | 25 a 30,5 min |
| Espera entre compras iniciada antes de 5 min | mediana 1,6; p90 3,1 | até 4,3 min (Infernus, T1 → T2) |
| Idem, de 5 a 10 min | mediana 1,7; p90 3,6 | até 5,3 min (Vindicta, → T3) |
| Idem, de 10 a 15 min | mediana 1,8; p90 4,1 | até 5,0 min (Abrams, → T3) |
| Idem, de 15 a 30 min | mediana 1,9–2,2; p90 4,5–5,0 | até 5,8 min |

Quem passou mais tempo parado antes dos 15 min vence menos: maior espera abaixo de 3,5 min, 51,2%;
5–6,5 min, 49,4%; 8+ min, 45,9%. É associação, não prova: quem está perdendo também junta mais devagar.

Causas no código:

1. **Custo medido em souls, não em tempo** (`optimize.ts`, `scoreOption`). 1.600 souls custam ~3 min no começo
   (~600/min) e ~1 min no fim (~1.700/min), mas valem o mesmo na conta. `MAX_WAIT_SOULS = 2500` tem o mesmo problema.
2. **`tierGates` libera tiers tarde.** Usa o minuto *médio* de compra de cada item, não a distribuição das compras.
   O herói fica com 700 a 2.200 souls parados esperando o gate, mesmo já podendo comprar.
3. **Itens que ninguém compra.** 13 das 18 compras da Paige e 8 das 18 do Infernus têm menos de 5% de compra
   com o herói, muitas delas baratas (Battle Vest, Weapon Shielding).

**Fontes.** O `deadlock-api` tem o que falta: `item-flow-stats` (itens por fase da partida, com winrate ajustado)
e `ability-order-tree` (ordem de habilidades por prefixo, com minuto). Os dois responderam nos testes. Localmente já
há as compras individuais de 20 mil partidas (`data/raw/wpa`).

## 2. Batches

Regra: cada batch termina com `npm run check` verde (hoje: 195 testes), conferência no navegador (desktop e 375 px,
pt e en) e commit. Interface (1–4) e otimizador (5–6) não se misturam: até o batch 4 a build calculada não pode mudar.

### Batch 0: rede de segurança
- `scripts/order-report.ts` (`npm run order-report`): para os 6 heróis, minuto do primeiro T2/T3/T4, maior espera por
  fase, souls parados, % de compra de cada item, pontuação, e os números dos jogadores ao lado.
- Guarda a saída atual em `reports/order/antes.txt`.
- **Pronto quando:** o relatório reproduz a tabela acima; nenhum arquivo do app muda.

### Batch 1: mouse-over de itens e habilidades
- Novo `web/tooltip.ts`: um só tooltip na página, aberto por mouse, foco do teclado e toque; fecha com Esc; não sai da tela.
- Conteúdo do item: nome, slot, tier, preço, ativo/passivo, atributos, texto do efeito e **% de compra por partida**.
  Habilidade: nome, descrição, cooldown e o que cada upgrade dá.
- Liga em todos os ícones: trilha, build final, ordem de compra, teorias, comparações, habilidades e aba de sinergias.
  Remove os `title` nativos que duplicariam.
- **Risco:** o ícone é recriado a cada `refresh`; o tooltip precisa fechar ao redesenhar. A página publicada é arquivo
  único com CSP: sem biblioteca externa. Textos do jogo ficam em inglês, como já vêm.

### Batch 2: barra lateral e comparativo
- "Ordem de compra", "Partida" e "Lutas": só o título com um ícone de informação; o texto vai para o mouse-over.
  O checkbox "Montar compra a compra" continua visível.
- "O que a build muda": colunas **Mais jogada | Esta build | Diferença**, usando `payload.comparisons[0].result.metrics`.
  Nome, partidas e winrate da build mais jogada na legenda. Sem estatísticas: cai para o elo alto, depois para "Sem itens".
  Reserva conferir: builds publicadas têm só os itens que cabem em 50 mil souls e 12 slots; mostrar quantos souls cada
  lado gastou, para não comparar uma build incompleta com uma cheia.
- Os cartões "Comparado com as builds mais jogadas" perdem a tabela repetida e viram uma linha de ícones por build.

### Batch 3: ordem de compra compacta
- Uma linha por compra: ícone, nome, minuto, preço, **% de compra por partida** e no máximo um selo
  (melhora X / vende X / vira X). Meta: ~56 px por linha.
- Um único motivo visível, e só quando for forte: interação com outro item da build ou com o kit de pontuação alta
  (corte inicial `Link.score >= 1,6`, "forte" na escala da wiki; calibrar com o relatório), ou discordância entre o modelo
  e as partidas. Sinergia baixa ou básica some.
- O resto (jogada, confiança, WPA, partidas ×N, desempate, alternativa, fontes) vai para o mouse-over da linha,
  e um clique expande, para funcionar no celular. "Fixar" e "Tirar" aparecem no hover, no foco e ao expandir.
- "Jogadas da build" e "Teorias": recolhidas, com as 3 principais de cada.
- **Pronto quando:** ordem de compra abaixo de 1.500 px e página abaixo de 4.500 px.

### Batch 4: habilidades
- Sai a lista de upgrades com bolinhas (tudo é maximizado).
- Entra uma grade em destaque: linhas = 4 habilidades, colunas = 1º ao 15º ponto, distinguindo **desbloqueio** e
  **upgrade 1/2/3**, com o minuto médio. "Maximizam primeiro" vira uma linha de resumo.
- Dados: `scripts/elite.ts` passa a ler `ability-order-tree` e seguir, a cada ponto, o ramo mais jogado. Hoje usamos a
  sequência completa mais jogada, que cobre só 1,4% a 30% das partidas. Cada ponto guarda a fatia de quem segue o ramo;
  ramo com amostra pequena cai para a ordem completa atual.
- Regera `elite.json` sem mexer nos itens dele: baixar só a chamada nova mantém as demais do cache.

### Batch 5: cortar itens baratos sem utilidade (muda a build)
- No otimizador, não na tela: esconder uma compra deixaria a rota com souls e slots que não fecham.
- T1 e T2 (800 e 1.600) saem do conjunto quando **as duas** valem: menos de 5% de compra com o herói (todos os elos e
  elo alto) **e** nenhuma sinergia forte com o kit. Componente de um item mantido continua disponível; item fixado nunca é cortado.
- Sem estatísticas do herói, não corta nada.
- Decisão em aberto: aplicar também a T3/T4 (Glass Cannon na Paige tem 0%). Ver seção 3.
- **Pronto quando:** nenhuma T1/T2 cortada aparece, todos os heróis ainda enchem a build e os testes de pico de vitality passam.

### Batch 6: ordem de compra pelo tempo (muda a build)
1. **Gates reais:** gerar `data/snapshot/timing.json` de `data/raw/wpa` com a distribuição do minuto da compra por herói e
   tier (p10, p25, p50). `tierGates` usa o p10; herói com pouca amostra usa o geral.
2. **Custo em minutos:** o ganho é dividido pelos minutos até a compra (`minuteForSouls`), não pelos souls.
3. **Espera máxima por fase:** troca `MAX_WAIT_SOULS` pelo p90 de espera dos jogadores (3,1 min até os 5; 3,6 até os 10;
   4,1 até os 15; 5,0 depois).
4. **Referência de ordem:** `item-flow-stats` no elo alto por fase de 5 min, como desempate entre compras de valor parecido.
   Só se 1–3 não bastarem.
- Cada passo é um commit com `reports/order/depois-N.txt`; passo que piora o relatório ou a pontuação média em mais de 2% volta atrás.
- **Pronto quando:** nenhuma espera passa do p90 da fase (salvo quando nada mais cabe), o primeiro T2/T3/T4 fica entre p10 e
  p75 dos jogadores e a pontuação final não cai mais de 2%.

### Batch 7: fechamento
- Remove CSS e textos órfãos, revê o inglês, atualiza README e a skill `deadlock-build`, gera `npm run artifact` e confere a
  página publicada. Push para a `main` publica no GitHub Pages: só com o seu ok.

## 3. Decisões em aberto

- **Batch 5, itens caros:** recomendo também limitar T3/T4 com menos de 2% de compra, exceto com sinergia forte. Não cortar
  mantém a build cheia de itens que ninguém usa; cortar demais copia o meta. Medir no batch 5 antes de ligar.

## 4. Ordem

0 → 1 → 2 → 3 → 4 → 5 → 6 → 7. O 3 depende do 1; o 6 depende do 0 e do 5. O 2 e o 4 podem trocar de lugar.
