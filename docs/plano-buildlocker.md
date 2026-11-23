# Plano: buildlocker.gg como fonte de dados

Levantamento feito em 22/11/2026 navegando o site (versão 1.0.2) e observando as chamadas que as páginas fazem.

## 1. O que o site tem

O Buildlocker é da equipe do Statlocker. Os dados vêm de duas fontes:

- **Companion App:** lê a build equipada de cada jogador visível na partida.
- **Registros de partidas:** usados para estatísticas de itens e para o modelo WPA.

Os IDs de item, herói e habilidade são os mesmos do deadlock-api.com (`itemId`, `className`, `heroId`), então dá para cruzar sem tabela de correspondência.

| Dado | Endpoint (interno) | O que traz | Temos hoje? |
|---|---|---|---|
| **WPA por item** (Win Probability Added) | `/api/info/wpa-filtered-items?hero=&rank=&patch=&minSampleSize=...` | WPA médio, `aheadWpa` / `behindWpa` (comeback vs win-more), `mean_prob_before`, `mean_net_worth_before`, `best_purchase_time`, tempo médio de compra, WPA por herói (`heroData`) | **Não.** Hoje usamos o winrate por janela de compra, que ignora o estado da partida antes da compra (limitação descrita em `src/meta/windows.ts`) |
| **Página do herói** | `/api/build/hero-page/<slug>` | Caminho de itens do **top 2% ranked** (taxa de compra, tempo médio, winrate, WPA, tier S–D, fase lane/mid/late, core), situacionais, **ordem de habilidades** dos pros, itens subestimados/superestimados | Parcial: temos builds publicadas populares, mas não o recorte de elo alto nem a ordem de habilidades |
| **Builds da comunidade com uso real** | `/api/build/reality/<id>`, `/api/build/proof/<id>` | Quanto os jogadores seguem cada slot da build, itens "mortos", winrate por elo, changelog | Não |
| Stats por item/herói | `/api/info/get-item-stats/...`, `get-hero-stats/...` | Vitórias e partidas por item | Já temos via deadlock-api |
| Patches | `/api/info/patches-with-ids`, `/api/info/game-data-version` | Notas de patch e versão dos dados | Já temos via deadlock-api |

O WPA mede quanto a chance de vitória muda depois da compra, comparando com o estado da partida antes dela. Ele resolve o principal viés do winrate cru: quem compra item caro tarde já estava ganhando.

## 2. Bloqueio: permissão de acesso

- **`robots.txt` bloqueia `/api/` para qualquer cliente automatizado** (`User-agent: *` e os crawlers de IA). Só Googlebot e Bingbot podem acessar.
- A API não tem documentação pública, e o site é "All Rights Reserved".
- Um script nosso chamando `/api/` iria contra a regra publicada do site.

**Fase 0 (antes de escrever código):** pedir autorização ao Statlocker, pelo Discord (discord.com/invite/p2smRXcgPq) ou pela página "Business enquiries". O pedido:

- uso não comercial e com atribuição;
- uma coleta por patch, com cache local;
- perguntar se existe endpoint ou export oficial para o WPA e para a página do herói.

Se negarem ou não responderem, o plano para aqui. O app continua só com o deadlock-api. A alternativa mais próxima é calcular um WPA aproximado a partir de `/v1/matches/metadata`, que já usamos em `scripts/fights.ts`. É um trabalho bem maior.

## 3. Plano de implementação (depois da autorização)

### Fase 1: coleta e snapshot

- Novo script `scripts/buildlocker.ts` (`npm run buildlocker [-- --refresh]`), no mesmo padrão de `stats.ts` e `windows.ts`:
  - grava o bruto em `data/raw/buildlocker/` (fora do git);
  - espera entre as chamadas e envia um User-Agent genérico identificando o projeto;
  - baixa `wpa-filtered-items` uma vez por grupo de elo (ex.: todos os ranked; Oracle+), sempre com `patch=` do patch atual;
  - baixa `hero-page/<slug>` para cada herói jogável (44 chamadas).
- Normalizar para `data/snapshot/buildlocker.json`:
  - `items[className]`: `wpa`, `aheadWpa`, `behindWpa`, `n`, `bestMinute`, `meanMinute`, `probBefore`;
  - `heroes[heroId]`:
    - `itemWpa[className]`: `wpa`, `n`;
    - `proPath`: itens do top 2% com taxa de compra, minuto, fase e core;
    - `situational`;
    - `abilityOrder`: `steps`, `winrate`, `n`.
  - `meta`: patch, cohort, data, URL da fonte.
- Converter os nomes de herói do site (`Grey_Talon`, `Mo_and_Krill`) para os IDs do nosso snapshot. Avisar quando um nome não for encontrado.
- `src/data/types.ts`: adicionar o tipo `BuildlockerData` e o campo opcional `buildlocker?` em `GameData`.
- `src/data/load.ts` e `web/main.ts`: carregar como arquivo opcional, igual a `stats.json` (sem o arquivo, o app funciona como hoje).

### Fase 2: módulo `src/meta/wpa.ts`

- `wpaFor(data, heroId, item)`: junta o WPA do herói com o WPA global, com peso `n / (n + K)`. O `heroData` do site tem amostras de 4 a 8 partidas em vários heróis, então o valor do herói não pode ser usado puro.
- `stateLean(item)`: `behindWpa - aheadWpa` para classificar o item como comeback, neutro ou win-more.
- `timingGap(item, minute)`: distância entre o minuto planejado pelo otimizador e o `best_purchase_time`.

### Fase 3: integração no app

1. **Prior do otimizador** (`src/optimizer/optimize.ts`, por volta da linha 367): hoje `tierPrior` / `priorFactor` usam winrate por janela. Adicionar o WPA como sinal alternativo (ou combinado) e escolher pelo teste da Fase 4. Não trocar sem medir.
2. **Estado da partida**: novo parâmetro opcional `gameState: "ahead" | "even" | "behind"` no `OptimizeInput` e no seletor da UI. Ele pesa os itens por `aheadWpa` ou `behindWpa`.
3. **Comparação** (`src/meta/compare.ts`): incluir o "caminho top 2% ranked" como mais uma referência, ao lado das builds publicadas populares. Ele passa pelo mesmo motor e usa o mesmo orçamento de souls.
4. **Explicação da compra** (`web/build-view.ts`): mostrar o WPA e o tier do item, uma etiqueta de comeback/win-more e um aviso quando a compra está muito antes ou depois do melhor minuto.
5. **Ordem de habilidades**: exibir a ordem dos pros (com winrate) junto da build. Depois, avaliar se vale usar como padrão de `abilityTiers` no motor (`src/engine/progression.ts`).
6. **Atribuição**: link "Dados de WPA: buildlocker.gg" no rodapé, com a data do snapshot. Também no README.

### Fase 4: validação

- Testes em `tests/buildlocker.test.ts` com uma fixture pequena:
  - normalização;
  - conversão de nomes de herói;
  - peso de amostra;
  - fallback quando o arquivo não existe.
- Relatório `npm run report`: rodar o otimizador para todos os heróis com o prior atual e com o prior WPA. Comparar a concordância com o caminho do top 2% e o WPA somado das builds.
- Conferir com `reports/combo/paige-*` que a Paige não piora nos objetivos já ajustados.
- `npm run check` (typecheck + testes) verde.

### Fase 5: rotina de patch

- `scripts/update.ts`:
  - chamar `buildlocker.ts` depois do snapshot;
  - avisar quando o patch dos dados do Buildlocker for anterior ao patch do snapshot (o WPA demora a acumular amostra depois de um patch, como o próprio site avisa).
- Atualizar a skill `deadlock-build` para citar o WPA ao explicar uma compra.

## 3B. Alternativa sem o Buildlocker: os mesmos sinais pelo deadlock-api

Conferido na API em 22/11/2026. Os mesmos sinais saem de endpoints que já usamos, com outros parâmetros.

| Sinal do Buildlocker | Como obter no deadlock-api |
|---|---|
| WPA por item, à frente/atrás | Calcular nós mesmos com `/v1/matches/metadata`, pedindo `include_player_items` e `include_player_stats`. Cada compra traz `game_time_s` e `net_worth_at_buy`. Cada jogador tem uma série de `net_worth` por tempo (cerca de 6 pontos numa partida de 21 min), que dá a diferença de patrimônio entre os times no momento da compra |
| Caminho do elo alto | `/v1/analytics/item-stats` com `min_average_badge` (ex.: 101 = Phantom+) e `bucket=game_time_min`: taxa e minuto de compra no elo alto |
| Ordem de habilidades | `/v1/analytics/ability-order-stats?hero_id=&min_average_badge=` |
| Sequências de itens (T4 chains) | `/v1/analytics/item-flow-stats` e `/v1/analytics/item-permutation-stats` |

**Nosso WPA (modelo):**

1. **Modelo de vitória:** regressão logística de `P(vitória | diferença de patrimônio dos times, minuto)`, ajustada nas próprias partidas baixadas. A diferença de patrimônio vem da interpolação das séries de `net_worth`.
2. **Valor da compra:** para cada compra, `resultado − P(vitória no momento da compra)`. É a vitória acima do esperado para aquele estado da partida.
3. **WPA do item:** a média desse valor. Comparar com os outros itens do mesmo tier comprados no mesmo minuto separa o efeito do item do efeito de "quem compra está ganhando".
4. **À frente/atrás:** separar as compras pelo sinal da diferença de patrimônio no momento da compra.

Não é idêntico ao WPA do Buildlocker, que mede a mudança da probabilidade depois da compra. Mas atende ao mesmo objetivo: tirar o viés do estado da partida.

**Volume:** amostra boa por herói pede de 20 a 50 mil partidas. O script baixa as partidas por páginas, como `scripts/fights.ts` já faz, mas compacta no download: guarda só compras, série de patrimônio, time e resultado. Por herói fica abaixo de 10 mil compras de cada T3/T4, por isso vale o peso de amostra da Fase 2 (WPA do herói misturado com o WPA geral).

**Ordem:**

1. ✅ Ordem de habilidades e caminho do elo alto (`npm run elite`).
2. ✅ Script `npm run wpa` com o modelo, gravando `data/snapshot/wpa.json`, e o WPA na explicação de cada compra.
3. ✅ WPA no otimizador (Fase 3.1), depois do relatório `npm run priors` (resultado em `reports/priors/fontes-do-peso.txt`). O WPA sozinho, com 20 mil partidas, tem intervalos largos e quase não mexe na build; o padrão virou o **blend**: winrate por janela e WPA pesados pela precisão, com 2 pp de viés somados à variância da janela. Nos 44 heróis, o blend dá o maior WPA médio dos itens (0,10 pp, contra 0,05 da janela) e custa 1,4% da pontuação do modelo (a janela custava 2,5%).
4. ✅ Rotina de patch (Fase 5): o `npm run update` lista a idade de cada dado de partidas e o comando para atualizar; o `npm run wpa -- --refresh` baixa partidas novas.
5. Pendente: seletor "à frente / atrás" no app (Fase 3.2), usando os valores de virada e win-more que já estão no wpa.json.

**Como ficou o download:** a API devolve as compras com `include_player_items` sem precisar de `include_player_info` nem de `include_player_stats` (cerca de 54 KB por partida, contra 400 KB com as estatísticas). A série de patrimônio vem do `net_worth_at_buy` de cada compra e de cada upgrade de habilidade, uns 30 pontos por jogador.

## 4. Riscos

- **API interna sem contrato:** pode mudar a qualquer momento. O snapshot fica versionado no git e o app aceita a ausência do arquivo.
- **Viés do Companion App:** as builds vêm de quem usa o app (o site corrige o viés de time no winrate das builds). O WPA vem dos registros de partida e é menos afetado.
- **Amostra pequena após patch:** usar `minSampleSize` alto e o peso de amostra da Fase 2.
- **Mais de uma fonte:** `meta.json` passa a listar as duas fontes e as datas de coleta de cada uma.
