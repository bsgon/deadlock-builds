# Plano: builds v2, da compra gulosa para um plano de partida

Escrito em 24/11/2026. **Batches 0 a 6 feitos; o 7 não será feito (o modo `plan` do 4 não passou na validação do 5 e fica fora do padrão) (seção 7); o resto é plano.** Medições sobre o commit `dcdc250`, snapshot do cliente 6861 (09/11/2026).

## 1. O que medi

App: 44 heróis, "Otimizada", 50 mil souls, 12 slots. Jogadores: 1.000 partidas recentes (todos os elos) e
998 de elo alto (`average_badge ≥ 101`), de `/v1/matches/metadata`. Nas partidas, `flags = 1` foi lido como
componente consumido (coincide quase sempre com o upgrade comprado no mesmo segundo); vendas em menos de 45 s foram
descartadas como provável desfazer na loja. É uma inferência do dado, não documentação da API.

### 1.1 Vendas

| | App (50k) | Jogadores, todos | Jogadores, 50k+ | Elo alto, 50k+ |
|---|---|---|---|---|
| Vendas por build | 1,64 | 0,94 | 2,95 | 3,09 |
| Souls perdidos nas vendas | 1.227 | 646 | 2.490 | 2.251 |
| Vendas com menos de 10 min de posse | 11% (8 de 72) | 8,4% | 6,1% | 2,8% |
| Tier vendido (T1 / T2 / T3+) | 18 / 79 / 3% | 51 / 39 / 9% | 30 / 53 / 17% | 33 / 60 / 7% |

**Vender não é o erro em si**: com 50k, os jogadores vendem até mais que o app. O erro é *o que* o app vende e *por quê*:

- **Cadeia de descarte.** Lady Geist: 39,3 min Monster Rounds → Recharging Rush; 40,8 vende-o por Torment Pulse (T3, 3.200);
  41,8 vende Torment Pulse por Metal Skin. São 2.400 souls perdidos em 2,5 min nos dois itens novos, para +1,5% no último passo.
- **Compra perto da venda.** Vindicta: Extended Magazine aos 28,8 e vendido aos 33,3. Paige: Improved Spirit (1.600) aos 29,3, vendido aos 34,3.
- **Trocas por ruído.** 20 das 72 trocas rendem menos de 5%; Infernus (0,3%), Violet (0,6%) e Celeste (0,7%) trocam quase de graça.

### 1.2 O problema maior: os itens

**239 dos 527 itens finais (45%) são comprados em menos de 5% das partidas do herói**, inclusive no elo alto.

| Item | Heróis que recebem | Compra média, todos | Compra média, elo alto |
|---|---|---|---|
| Blood Tribute (T3) | 36 de 44 | 0,9% | 1,3% |
| Diviner's Kevlar (T4) | 30 | 3,6% | 3,4% |
| Bullet Resilience (T3) | 28 | 4,8% | 3,7% |
| Frenzy (T4) | 25 | 2,5% | 1,0% |
| Weighted Shots (T3) | 23 | 3,8% | 4,0% |
| Alchemical Fire (T3) | 22 | 1,3% | 2,3% |

O mesmo item em 36 heróis indica condição superestimada no motor (uptime, custo em vida, valor de stack) ou objetivo
que só soma DPS, não meta escondido. Corrigir só a ordem de compra deixaria isto intacto.

### 1.3 O alvo está no momento errado

- O alvo é a build de 50k. O último patrimônio registrado numa compra tem mediana de 33,6k (todos) e 29,8k (elo alto);
  p90 de 52,1k e 43,4k. A partida mediana dura 36,7 e 32,2 min.
- **A maioria dos T4 que exigem venda entra depois dos 34 min, quando metade das partidas já está acabando.**
- A build planejada para 33k/11 slots, medida pelo mesmo motor, é **2,7 a 14% melhor em todos os pontos de 5k a 35k**
  (média dos 44 heróis) e, como para em 33k, perde depois. Ela tem 27 vendas em 44 heróis, contra 72.
- O otimizador usa **12 slots desde o minuto zero**, mas o relatório do batch 0 mostrou que isso quase não pesa: a rota tem 4/7/10/12 itens aos 10/20/30/40 min (mediana), igual ou perto dos jogadores. A regra é 9 + 1 por Walker. Itens equipados (p50/p90):
  4/6 aos 10 min, 8/9 aos 20, 9/10 aos 25, 11/12 aos 35.
- A rota que segue o alvo direto (modo `final`, sem nenhuma venda) pontua 2,8% mais aos 50k que a progressiva e
  oscila antes (0,93× a 1,35×). Então **as vendas atuais nem compram uma build final melhor**.

Ressalva: estes ganhos usam o próprio motor, que a seção 1.2 mostra ter viés. Provam que a *busca* é subótima, não que a build vence mais.

## 2. Causas no código

| # | Causa | Onde |
|---|---|---|
| C1 | Decisão míope: cada passo maximiza ganho/soul agora; a venda futura é multa fixa de 50% que ignora *quando*, *se* e por quanto tempo o item rendeu | `effectivePay`, `pick` em `src/optimizer/optimize.ts` |
| C2 | T4 não paga essa multa; item do alvo ganha 30% de desconto mesmo que seja vendido depois | `effectivePay`, `TARGET_PULL` |
| C3 | O laço de trocas tardias continua enquanto o ganho passa de 0,02 ponto *absoluto*; o custo em souls não entra e um item recém-comprado pode ser vendido | `MIN_SWAP_GAIN`, `MAX_LATE_SWAPS` |
| C4 | A vítima é escolhida antes do comprador (a que perde menos agora), não em par com ele | `victim` |
| C5 | Slots constantes durante a partida | `itemSlots`, `web/build-view.ts` (`SLOTS = 12`) |
| C6 | Um só alvo, em 50k | `target`, `web/build-view.ts` (`SOULS = 50_000`) |
| C7 | Estatística só ajusta (exp(peso·Δ/10)) e a poda de uso padrão vale só para T1/T2 | `priorFactor`, `unusedItems` |
| C8 | `sold_time_s` é descartado ao compactar partidas: o app nunca viu como os jogadores vendem | `scripts/wpa.ts` (`compact`) |
| C9 | O RAG não tem as páginas da loja (`Items`, `The_Curiosity_Shop`) e as 89 teorias `late-swap` não têm evidência das partidas | `scripts/wiki.ts`, `scripts/theory.ts` |

Teorias de venda do nosso RAG: 89 trocas; 61 vendem T2, 14 T1, 12 T3, 2 T4. A mais repetida é Healbane → Spirit Burn
(Yamato em 5 builds: 875365, 947204, 953659...; Lash, Apollo, Lady Geist, McGinnis em 4). É o padrão bom: **vende-se um item cuja função outro
passa a cumprir**.

## 3. Regras do jogo e fontes

| Regra | Fonte | Nível |
|---|---|---|
| Investimento por soma gasta na árvore; itens com desconto do componente; slots universais | Valve, "Shop Rework Update", 08/05/2025 [V1] | Oficial |
| 9 slots base + 3 flex, um por Walker; salto extra aos 4.800 | Valve, "11-21-2025 Update" [V1][V2] | Oficial |
| Tabela: linhas 4,8k / 6,4k / 8k / 11,2k / 16k; Weapon 46/54/62/74/86, Vitality 38/42/46/50/54, Spirit 38/45/52/59/66 | Valve, "Gameplay Update 05-22-2026" [V1][V3] | Oficial; o nosso `shared.json` bate nas três árvores |
| Autor da build pode definir prioridade de venda (0–100), usada pelo Quickbuy com slots cheios | Valve, 08/05/2025 [V1] | Oficial |
| Vender devolve **metade**; devolução total antes de sair da área da loja | deadlock.wiki [W1][W2], Deadlock Handbook [H1] | **Comunidade**: não achei texto da Valve |
| Investimento some ao vender; 4 ativos no máximo | [W1][W2][H1] | Comunidade |
| Componente consumido vale o preço cheio | [W1][W2] (a Valve [V1] confirma o desconto, sem o valor) | Comunidade |

Theorycrafting (opinião de guias, não regra):

- Planejar de trás para a frente a partir do primeiro pico e comprar os componentes no caminho [B1].
- Vender itens baratos só quando a substituição já pode ser comprada [B1].
- Chegar aos 4.800 com itens já planejados, sem vender o que funciona para isso [P1].
- Vender T1 por falta de espaço é normal [H2]; Golden Goose Egg sai por volta dos 20 e poucos minutos e Restorative Shot por volta dos 30 [H1].
- Counter-item responde ao que o inimigo faz, logo é situacional e não entra na rota fixa [B1].

### Referências

- [V1] [Notícias oficiais da Valve, API da Steam](https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=1422450&count=100&maxlength=0&feeds=steam_community_announcements) (texto lido aqui)
- [V2] [Fórum oficial, 11-21-2025](https://forums.playdeadlock.com/threads/11-21-2025-update.90383/) (link listado pela API; texto lido em V1)
- [V3] [Steam, Gameplay Update 05-22-2026](https://store.steampowered.com/news/app/1422450/view/670617878982034052) (a página não abriu o corpo; texto lido em V1)
- [D1] [deadlock-api.com](https://api.deadlock-api.com) (partidas, builds e dados de itens): fonte principal do projeto; API da comunidade, **não** é da Valve
- [W1] [deadlock.wiki, Items](https://deadlock.wiki/Items) · [W2] [The Curiosity Shop](https://deadlock.wiki/Curiosity_Shop)
- [H1] [Handbook, How the shop works](https://deadlockhandbook.com/items/how-the-shop-works/) · [H2] [Build theory](https://deadlockhandbook.com/items/build-theory/)
- [B1] [Deadlock Bible, Build theory](https://deadlockbible.com/guides/building-theory/)
- [P1] [VPEsports, guia de investimento](https://deadlock.vpesports.com/news/deadlock-shop-investment-guide-plan-components-and-the-4800-power-spike)

## 4. Nova lógica

### 4.1 Otimizar a partida inteira

Para uma rota π, maximizar a força em cada minuto, pesada pela chance de a partida ainda existir:

```
J(π) = Σ_t  P(partida dura até t) · ln( força(inventário_π(t), nível(t), t) )
```

Com isso a venda fica precificada sem multa arbitrária: os souls perdidos atrasam tudo o que vem depois, e o item vendido
só se paga pelo que rendeu enquanto estava equipado. Um item comprado 5 min antes de sair deixa de compensar por si só.

### 4.2 Três marcos em vez de um alvo

Alvos em **~12k (15 min), ~30k (30 min) e ~45k (40 min)**, pela curva do herói. Peso de cada um = P(duração).
O alvo de 30k é a **build principal**; o de 45k vira extensão "se a partida alongar".

### 4.3 Busca em feixe com plano de slots

- Estado: inventário, souls, minuto, histórico de posse. Feixe de ~24 rotas, 3 marcos; memo já existente.
- Ações: comprar, melhorar, esperar, **vender e comprar em par** (todas as vítimas, não só uma).
- Slots por minuto: 9, depois 10, 11 e 12 no minuto mediano real de cada um (medir por herói).
- A primeira solução vem de trás para a frente: alvo → componentes → peças de rota. Item fora de todos os alvos só entra como **peça temporária** explícita.

### 4.4 Regras duras de venda

1. Nada comprado a menos de **10 min** da própria venda (jogadores: p10 de 11,3 a 12,5 min).
2. Um item que entrou por troca nunca é vendido (elimina cadeias).
3. Cada troca precisa aumentar J e a força em pelo menos **5%**, já pagos os souls; senão o soul fica guardado.
4. Até 40k: no máximo 1 venda; depois, 3. Preferência por T1; T2 só com slots cheios; T3+ só com evidência das partidas.
5. Não vender para cair abaixo de um degrau de investimento (4.800 em especial), salvo se a compra o repõe no mesmo passo.
6. Se a venda ocorre, a compra original é marcada na interface: "temporário, sai aos ~30 min, custo líquido 400".

Os limiares de 5% e as cotas são escolhas de projeto; o batch 0 permite variá-los.

### 4.5 Corrigir os itens antes da ordem

- **Auditoria dos itens repetidos**: Blood Tribute, Diviner's Kevlar, Frenzy, Weighted Shots, Alchemical Fire, Bullet Resilience, Glass Cannon, Mercurial Magnum. Conferir uptime, custo e condição de cada um no texto do jogo.
- **Prior de uso com encolhimento em todos os tiers**: compra rara no elo alto reduz o ganho do modelo; não é veto. Item raro só passa com ganho grande *e* WPA não negativo com amostra.
- Core = itens que sobrevivem em várias rotas do feixe; o resto é flex ou situacional.

### 4.6 RAG útil para decidir

- Baixar `Items` e `The_Curiosity_Shop` para o corpus, com revid; regras viram testes com citação.
- Extrair `sell_priority` das builds publicadas como dado numérico (hoje só vira texto em `scripts/theory.ts`).
- Dar evidência às 89 teorias `late-swap`: quantos jogadores fazem a troca, quando, e o WPA ajustado.
- Uma teoria só soma peso quando há evidência; opinião isolada aparece como nota com o link da build.

## 5. Batches

Cada um fecha com `npm run check` verde (hoje: typecheck limpo, 219 testes) e o relatório antes/depois.

| Batch | Entrega | Pronto quando |
|---|---|---|
| 0. Medir | `npm run build-report`: vendas, posse, perda, % de itens raros, J, slots por minuto | Reproduz as tabelas da seção 1 |
| 1. Dados | `sold_time_s`/`flags` nas partidas compactas (exige baixar de novo, `--refresh`); `sales.json` (posse, trocas, slots por herói); RAG da loja | Vendas e slots por herói com amostra; regras citadas |
| 2. Itens | Auditoria (4.5) e prior de uso | Itens finais com menos de 5% de compra: **45% → até 15%**; nenhum T3+ em mais de 20 heróis sem uso real |
| 3. Correção rápida | Regras 1, 2, 3 e 5 no otimizador atual; slots por minuto | Zero venda com posse < 10 min; zero cadeia; zero troca < 5% |
| 4. Novo otimizador | J, marcos e feixe em `src/optimizer/plan/` atrás de opção; o antigo fica para comparação | J maior em pelo menos 40 de 44 heróis; no máximo ~3 s por build no worker |
| 5. Validação | Partidas fora da amostra: a semelhança com a rota v2 prevê vitória ajustada ao patrimônio melhor que com a v1? | v2 ≥ v1; se não, não vira padrão |
| 6. Interface | Início → core 30k → extensão 45k; temporários marcados; flex e situacionais à parte | Conferido em desktop e 375 px, pt e en |
| 7. Limpeza | Remove o guloso, `TARGET_PULL`, `effectivePay` e as trocas tardias | Testes da v1 migrados ou apagados |

Dependências: 0 → 1 → 2 → 4 → 5 → 6 → 7. O 3 pode sair logo depois do 0 (só os slots por minuto dependem do 1).

## 6. Riscos

- **Imitar o meta**: o prior de uso pode matar descobertas legítimas. Por isso encolhe em vez de vetar.
- **Associação**: quem compra T4 já está ganhando. WPA reduz o viés, não elimina.
- **Amostra curta**: 1.000 partidas de poucos dias; refazer com as 20 mil do batch 1.
- **Regra dos 50%** não confirmada pela Valve: testar no jogo antes do batch 4.

## 7. Execução

**Batch 0** (`npm run build-report`): reproduz as tabelas da seção 1; pequenas diferenças (posse < 10 min de 8,2% em vez de 8,4%; 20 trocas fracas em vez de 21) vêm de
componentes de 2º nível e da base do percentual. Relatórios em `reports/builds/`.

**Batch 3** (`src/optimizer/sales.ts`, opção `saleRules`), 44 heróis, build do app (pico de vitality do herói):

| | Antes | Depois |
|---|---|---|
| Vendas por build | 1,52 | 1,16 |
| Souls perdidos por build | 1.145 | 855 |
| Posse < 10 min / em cadeia / ganho < 5% | 9 / 3 / 18 | 0 / 0 / 0 |
| Souls sem gastar por build | 838 | 1.311 |
| Pontuação final média | 7,759 | 7,733 (-0,3%) |
| J médio | 0,9262 | 0,9260 |
| Itens finais com < 5% de compra | 45% | 44% |

As travas tiram o desperdício; **não deixam a build mais forte** pelo motor (Apollo perde 5,4% na pontuação final).
Elas também não impedem comprar um item que sairá mais tarde: isso é o batch 4.

Diferenças: só o degrau de 4.800 é trava dura (os outros já pesam no motor); as cotas da regra 4 e os slots por minuto ficaram de fora
(dependem do batch 1, e os slots quase não pesam). Item fixado pode furar as travas; com 6 slots e 5 itens T4 fixados, um pode ficar de fora.

**Batch 1** (`npm run sales`): 20.000 partidas novas em `data/raw/sales`, separadas das do wpa para não trocar o `wpa.json`
junto. `sales.json` tem vendas, posse e slots dos 44 heróis (mínimo de 2.282 jogadores por herói).

- Posse até a venda: p10 de 12,2 min, mediana 25,7. Confirma a trava de 10 min. 0,96 venda e 662 souls perdidos por jogador.
- Minuto mediano do 10º, 11º e 12º item, entre quem chega lá: 26,1 / 30,3 / 34,9. Ainda não é usado pelo otimizador.
- RAG: `Items` (revid 244252) e `The Curiosity Shop` (187548) no corpus. A venda por metade está nas duas páginas.
- **Erro achado no RAG:** das 21.469 marcações `sell_priority` das builds, 19.971 (93%) são 0, o valor padrão. O extrator as
  escrevia como "[vender: prioridade 0]"; corrigido em `scripts/theory.ts`. As 89 teorias `late-swap` podem ter sido
  extraídas com esse ruído e **não foram reextraídas**. O dado numérico ainda não entra em `sales.json`.
- Evidência das 89 trocas: 0 confirmadas, 86 sem conclusão, 3 contrariadas (comparando só quem tinha o item vendido e
  slots cheios, com intervalo de ~99,7%). A troca só pesa no otimizador com 30+ trocas vistas e sem ser contrariada.
  As contrariadas somem da seção de teorias, como já acontecia com as outras.

**Batch 2**: auditoria do motor e peso do uso (`src/meta/usage.ts`).

| Item | O que estava errado | Correção | Fonte |
|---|---|---|---|
| Blood Tribute | Os 50 de vida/s sacrificados não custavam nada | Sai da vida efetiva | [wiki](https://deadlock.wiki/Blood_Tribute) |
| Diviner's Kevlar | Barreira de 1.000 em toda luta | Só com a ultimate pronta | [wiki](https://deadlock.wiki/Diviner's_Kevlar) |
| Frenzy | "Abaixo de 50% de vida" valia 50% da luta | 15% | texto do item; a fração é escolha nossa |
| Battle Vest, Enchanter's Emblem, Hollow Point | "Acima de 65%" valia 50% | 72% | idem |
| Mercurial Magnum | Bônus sobre o dano de bala já com % de arma | Sobre o dano base | [wiki](https://deadlock.wiki/Mercurial_Magnum) |

Weighted Shots (lentidão, stamina), Alchemical Fire (inimigo sai da área), Glass Cannon e Bullet Resilience: não achei conta errada que
eu pudesse provar; ficam para o peso do uso.

| 44 heróis, build do app | Batch 3 | Auditoria, sem uso | Com uso (0,02) |
|---|---|---|---|
| Itens finais com < 5% de compra | 44% | 43% | **15%** (78 de 528) |
| T3+ em mais de 20 heróis, compra < 5% | vários | Bullet Resilience, Cheat Death | **nenhum** |
| Vendas / souls perdidos por build | 1,16 / 855 | 1,18 / 918 | 0,91 / 700 |
| Souls sem gastar por build | 1.311 | 1.427 | **2.413** |
| Pontuação final média (modelo) | 7,733 | 7,276 | 6,659 |
| J médio (modelo) | 0,9260 | 0,9450 | 0,9264 |

As colunas não se comparam pela pontuação entre Batch 3 e as outras (o motor mudou). Da auditoria para o peso do uso, a força **pelo modelo** cai 8% no fim
e o J cai 0,019. Pesos testados: 0 → 43%, 0,015 → 20% (antes do conserto da condição de vida), 0,02 → 15%, 0,025 → 12%, 0,03 → 10%; ficou o menor que cumpre a meta.

**A auditoria sozinha quase não mudou a % de itens raros**: quem muda é o peso do uso, que olha a mesma taxa de compra da meta. Então os 15% não
provam builds melhores, só mais próximas do que se joga. Prova é o batch 5, em partidas fora da amostra.

**Batch 4** (`src/optimizer/plan/`, `mode: "plan"`, `npm run build-for -- ... --plan`, `npm run build-report -- --plan`). O app continua na progressiva.

- `simulate.ts`: executa uma lista de compras com as regras da loja, as travas, as cotas da regra 4, o slot que abre no minuto medido e o pico de
  vitality; mede J = Σ P(dura até t)·ln(pontuação(t)) / Σ P. J inclui o desconto por raridade e o ajuste das partidas.
- `search.ts`: feixe sobre rotas completas, a partir da progressiva e das rotas dos marcos de 15 e 30 min. Semente fixa.
- Diferença do plano: o feixe anda sobre rotas inteiras (muda, tira, põe, reordena), não monta a rota do começo ao fim; largura 4, não 24.

| 44 heróis, Otimizada, 50k | Progressiva | Plan |
|---|---|---|
| J da rota | 0,5595 | **0,5815** |
| Heróis com J da rota maior | | **40 de 44** (perdem: Drifter, Lash, The Doorman, Sinclair) |
| J do batch 0 (piso fixo, sem uso nem partidas) | 0,9264 | 0,9299 (maior em só 22 de 44) |
| Pontuação final em 50k | 6,659 | 6,451 (-3%) |
| Itens finais com < 5% de compra | 15% | 16% |
| Vendas por build / fora das travas | 0,91 / 0 | 1,00 / 0 |
| Souls sem gastar por build | 2.413 | 2.720 |
| Tempo por build (mediana / máximo, 44 seguidos) | 0,9 / 1,6 s | **4,8 / 10,8 s** |

Meta de J (40 de 44): cumprida no limite. **Meta de tempo (~3 s): não cumprida**; sozinho no processo fica em 3 a 4 s depois de aquecer e até 5,8 s na
primeira vez. Cerca de 2 s são as três rotas progressivas do começo.

Ressalvas:

- A configuração saiu de cerca de seis testadas nos mesmos 44 heróis, então 40 de 44 é otimista. Os números de quem perde mudam com a semente e o orçamento.
- O ganho aparece no J que a busca maximiza. No J do batch 0, que ela não vê, empata (22 de 44): é ganho de ajuste ao uso e às partidas, não de força.
- A progressiva usa os 12 slots desde o começo e não tem cotas; o plan respeita os slots medidos. Parte da perda de pontuação vem daí.
- Objetivo Controle: o plan ficou igual ou pior que a progressiva em parte dos heróis testados (Paige 0,668 → 0,655 na primeira versão) e a progressiva
  sozinha já passa de 5 s. Não serve ainda para ele.
- Souls parados não melhoraram: o fim da rota pesa pouco em J e a troca precisa render 5%.

### Batch 5: critério registrado antes de olhar os resultados (24/11/2026, 20h)

- **Amostra principal:** partidas com id acima da última de `data/raw/sales` (143141299). Nenhum dado do projeto as usou.
  Secundária: as 20 mil de `data/raw/sales` (posteriores a wpa, janelas e uso; `sales.json` saiu delas, mas só com slots, posse e trocas).
- **Rotas comparadas:** `original` (commit `dcdc250`, antes deste plano), `atual` (batches 2 e 3) e `plan` (batch 4).
- **Medida principal:** aos 25 min, inclinação da vitória ajustada ao patrimônio pela semelhança com a rota, dentro do herói, em pp por desvio-padrão;
  intervalo de 95% por reamostragem de partidas. 15 e 35 min são secundárias.
- **Regra:** o `plan` vira padrão só se a diferença `plan − atual` aos 25 min for ≥ 0 e o limite inferior ficar acima de −0,10 pp.
  As mudanças dos batches 2 e 3 se sustentam se `atual − original` não for negativa com intervalo abaixo de zero.
- Também se mede a semelhança descontado o uso (taxa de compra dos itens do jogador), para separar "rota boa" de "rota popular".

### Batch 5: resultado (`npm run validate-routes`)

Principal: 7.372 partidas nunca usadas. Secundária: 20.460 de `data/raw/sales`. Vitória ajustada, em pp por desvio-padrão de semelhança, aos 25 min:

| | Principal | Secundária |
|---|---|---|
| original (`dcdc250`) | 0,15 [-0,13; 0,45] | 0,23 [0,04; 0,42] |
| **atual** (batches 2 e 3) | **0,40 [0,08; 0,67]** | **0,36 [0,18; 0,56]** |
| plan (batch 4) | 0,24 [-0,07; 0,51] | 0,45 [0,27; 0,62] |
| placebo (rota atual de outro herói) | 0,06 [-0,25; 0,38] | 0,14 [-0,04; 0,31] |
| plan − atual | **-0,17 [-0,33; -0,01]** | 0,08 [-0,02; 0,19] |
| atual − original | **0,25 [0,00; 0,50]** | 0,13 [-0,02; 0,28] |

**Decisão pela regra registrada:** o `plan` **não** vira padrão (diferença negativa na principal; na secundária é positiva, com intervalo que cruza zero).
As duas amostras discordam no sinal: o mais honesto é dizer que os dois empatam. As mudanças dos batches 2 e 3 **se sustentam**: melhores que a original nas duas
amostras, sem intervalo abaixo de zero.

Limites:

- Efeitos de décimos de ponto: ter mais ou menos a build do app muda pouco a chance de vitória prevista pelo placar.
- Os jogadores seguem pouco qualquer rota: a semelhança média aos 25 min é 14% (atual) e 9,8% (original).
- **Controle que não passou de todo:** aos 15 e 35 min o placebo também dá efeito positivo na secundária (0,35 e 0,36, intervalos acima de zero) e, aos 35 min, na principal
  (0,51). Parte do efeito não é da rota do herói: vem de itens bons em geral ou de algo que o patrimônio não ajusta. Aos 25 min (a medida registrada) o placebo fica perto de zero.
- Mesmo aos 25 min, `atual − placebo` é 0,35 [-0,05; 0,70] e 0,22 [-0,01; 0,45]: perto, mas sem excluir zero.
- O peso do uso do batch 2 puxa a rota para o que se compra; descontar o uso quase não muda os números.
- Elo alto: só 188 partidas com elo médio informado. Sem conclusão.
- É associação, não prova de causa. Só a primeira tabela segue o critério registrado; o placebo foi acrescentado depois de ver a principal.

**Consequência para os batches 6 e 7:** a interface usa a rota atual. O batch 7 (apagar o guloso) **não deve ser feito**.

### Batch 6: interface (`web/stages.ts`, `web/build-view.ts`)

- Build final em dois blocos: core (o que está equipado aos 30 min) e extensão (o que entra depois), com a fração das partidas do herói que passa de 35 min.
- A ordem de compra usa as mesmas fases: início (15 min), core (30 min), extensão.
- Item vendido depois aparece como "temporário, sai aos N min"; nos detalhes, o que entra no lugar e o custo líquido.
- Flex: compras em que a alternativa do mesmo tier rende menos de 15% a menos por soul e é usada em 5%+ das partidas. Aparece em 9 dos 44 heróis.
- Situacionais: teorias das builds publicadas, fora da build e não contrariadas; saíram da seção de teorias. É opinião dos autores, e a tela diz isso.
- Diferenças: o core é a rota atual cortada aos 30 min, não uma build planejada para 30 min (isso era o `plan`, que não passou); e "flex" vem da
  alternativa da compra, não da estabilidade entre rotas do feixe.
- Conferido no navegador em 1400 px e 375 px, pt e en, sem rolagem lateral nem erro no console.
