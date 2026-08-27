# AUDITORIA-FRONT.md

Auditoria de leitura do frontend SkyGate. Nenhum arquivo do projeto foi alterado — este relatório é a única escrita.

- **Commit auditado:** `3841679` (branch `main`, working tree limpo)
- **Data:** 2026-08-27
- **Volume:** 52 arquivos `.js` em `src/` (8.709 linhas), 17 folhas `.css` (7.569 linhas), 9 suítes de teste Node
- **Stack:** vanilla ES modules, sem build, sem framework, sem dependências (`package.json` não declara `dependencies` nem `devDependencies`)

---

## 1. ESTRUTURA

### 1.1 Árvore real

```
skygate/
├── index.html                  Entrada da app. Carrega styles/index.css e src/main.js (type=module).
├── design_system.html          Página separada do styleguide. Carrega SÓ tokens.css + components.css + styleguide.css.
├── manifest.webmanifest        Manifesto PWA.
├── sw.js                       Service worker: precache do shell + stale-while-revalidate para origens confiáveis.
├── serve.js                    Servidor estático de dev sem dependências (node serve.js, porta 5173).
├── package.json                Só scripts (test/dev/start). Zero dependências.
│
├── assets/                     12 imagens estáticas (logos, favicons, ícones PWA, hero webp). NENHUM SVG.
│
├── src/
│   ├── main.js                 Ponto de entrada do browser: importa bootstrap e registra o service worker.
│   │
│   ├── app/                    Orquestração: ciclo de vida, roteamento de telas, eventos, cálculo de rota.
│   │   ├── bootstrap.js        init(): GET /airports -> GET /airports/{slug}/map -> normaliza -> restaura sessão -> render.
│   │   ├── router.js           render() por app.mode + atualizações parciais do mapa (rota/POI/labels/piso).
│   │   ├── actions.js          1.040 linhas. Todos os handlers de UI (busca, passos, pisos, voo, opções, ajuda).
│   │   ├── events.js           Binding de listeners no DOM recriado a cada render.
│   │   ├── routeController.js  handleCalculate(): POST /routes/calculate, valida e monta navState.
│   │   ├── constants.js        Re-export da camada de apresentação + FLOOR_LABELS, MIN/MAX_SCALE.
│   │   └── config/appConfig.js Configuração congelada: baseUrl da API, slug do aeroporto, metros/unidade, margens de voo.
│   │
│   ├── components/             Componentes de UI transversais (não são telas).
│   │   ├── Icon.js             Ícones de navegação por nome semântico.
│   │   ├── LocationDetail.js   Sheet de detalhe legado, baseado em nó.
│   │   ├── PlaceDetailSheet.js Sheet de detalhe rico (foto, horário, contato).
│   │   ├── SearchOverlay.js    Overlay de busca de origem/destino.
│   │   └── ds/                 Design System v5. 9 componentes que retornam string HTML + index.js barrel.
│   │
│   ├── map/                    Motor do mapa: geração de SVG, ajuste de enquadramento, pan/zoom, troca de piso.
│   │   ├── floorMapBuilder.js  723 linhas. Gera TODO o SVG (base, rota, POIs, labels) a partir de x/y dos nós.
│   │   ├── mapFit.js           Auto-fit da rota e do passo atual dentro da área visível real.
│   │   ├── mapPanZoom.js       Transform translate/scale, arrasto, pinça, roda.
│   │   ├── floorSwitch.js      Troca de piso + anúncio para leitor de tela.
│   │   └── svgMapCache.js      Cache genérico de promessas por piso. ÓRFÃO (ver 1.2).
│   │
│   ├── screens/                Uma pasta por tela.
│   │   ├── home/HomeScreen.js                   Tela de planejamento (app.mode 'planning').
│   │   ├── routeSummary/RouteSummaryScreen.js   Tela de escolha de rota (app.mode 'summary').
│   │   └── navigation/                          Tela de navegação (app.mode 'navigation'), 3 sub-visões.
│   │       ├── NavigationScreen.js              Dispatch por navState.view + visão 'map' + sheet + overview.
│   │       ├── NavigationShell.js               Header, toggle de visão, tira de resumo, tempo estimado.
│   │       ├── NavigationTimeline.js            Visão 'timeline' (lista de instruções).
│   │       └── NavigationRouteMap.js            Visão 'trajeto' (diagrama esquemático tipo metrô).
│   │
│   ├── services/               Regra de negócio e IO.
│   │   ├── api/                Única camada que fala HTTP (httpClient, airportsApi, routesApi, index barrel).
│   │   ├── normalize.js        Traduz payload cru da API para o shape interno (nodes, route, steps, segments).
│   │   ├── nodePresentation.js 342 linhas. Fonte única de todo texto visível + tabelas de override por código de nó.
│   │   ├── nodeSearch.js       Filtro e agrupamento da busca.
│   │   ├── routeSteps.js       521 linhas. Passos semânticos, distâncias, detecção de curva, guarda de acessibilidade.
│   │   ├── routeOptions.js     Opções de rota exibidas na tela de escolha + score por folga.
│   │   ├── flightSlack.js      Folga até o fechamento estimado do portão, derivada do horário do voo.
│   │   ├── placesMock.js       Nome legado. Hoje só adapta nós normalizados para o sheet de detalhe.
│   │   └── semanticStepBuilder.js  ÓRFÃO (ver 1.2).
│   │
│   ├── state/                  Estado mutável compartilhado e persistência.
│   │   ├── appState.js         app, planState, navState, mapState, uiState, appData. Objetos mutáveis exportados.
│   │   ├── selectors.js        Leituras derivadas (findNode, getFloorLabel, getAirportSlug, transform do piso).
│   │   ├── sessionPersistence.js  625 linhas. Snapshot da jornada em storage, com validação de schema na volta.
│   │   └── createStore.js      ÓRFÃO (ver 1.2).
│   │
│   ├── styleguide/styleguide.js  Renderiza design_system.html. Não faz parte do bundle da app.
│   └── utils/                  dom.js ($, root, prefersReducedMotion) e format.js (asArray, first, esc, clamp...).
│
├── styles/                     CSS puro. index.css é o manifesto de @import em ordem de cascata deliberada.
│   ├── tokens.css              Tokens. DOIS sistemas convivem: paleta v4 em :root e DS v5 escopado em .sg-ds.
│   ├── base.css, components.css, overlays.css, desktop.css, a11y.css
│   ├── screens/                home, planning, planning-v5, navigation, navigation-sheet,
│   │                           navigation-timeline, navigation-route-map, route-summary
│   └── components/place-detail.css
│
└── tests/                      9 suítes .mjs com node:assert. Sem runner, sem browser. Rodam via npm test.
```

### 1.2 Arquivos e componentes órfãos

**Módulos JS nunca importados pela aplicação** (só por testes):

| Arquivo | Situação |
|---|---|
| `src/map/svgMapCache.js` | `createSvgMapCache` só é importado por `tests/state-and-map.test.mjs:3`. O cache real usado em produção é `mapState.svgBaseCache` (objeto simples, `appState.js:66`), preenchido por `getBaseFloorSvg` (`floorMapBuilder.js:718`) e `preloadFloorSvgs` (`bootstrap.js:17`). O módulo é uma infraestrutura de carregamento assíncrono de SVG que nunca foi ligada. |
| `src/services/semanticStepBuilder.js` | `buildSemanticSteps` só é importado por `tests/state-and-map.test.mjs:4`. A app usa a implementação homônima de `src/services/routeSteps.js` (importada em `routeController.js:9` e `actions.js:34`). Duas implementações com o mesmo nome coexistem. |
| `src/state/createStore.js` | `createStore` só é importado por `tests/state-and-map.test.mjs:2`. O estado real é o conjunto de objetos mutáveis de `appState.js`; nenhuma store com subscribe está em uso. |

**Endpoint wrapper órfão:** `getAirport(slug)` (`src/services/api/airportsApi.js:4`) é reexportado em `index.js:2` e nunca chamado. `GET /airports/{slug}` não é consumido em lugar nenhum.

**Componentes do DS sem consumidor na app** (só aparecem no styleguide): `Metric` / `MetricGroup` (`ds/Metric.js`) e `Sheet` (`ds/Sheet.js`) — detalhado em 5.2.

**CSS órfão:**
- `.sg-planning` — 19 ocorrências em `styles/screens/planning.css` e 74 em `styles/screens/planning-v5.css`, e **zero** referências em qualquer `.js`. A Home foi reconstruída sobre as classes `sg-home*` (`HomeScreen.js:345` renderiza `class="sg-ds sg-home"`). As duas folhas somam 1.516 linhas e ainda são importadas por `styles/index.css:8` e `:12` e precacheadas pelo `sw.js:23-24`.
- `.sg-nav-chip`, `.sg-nav-chips`, `.sg-nav-next`, `.sg-nav-steps` — `styles/overlays.css:200-290`, sem nenhum consumidor em JS.

**Nada em `assets/` está órfão** — todos os 12 arquivos são referenciados por `index.html`, `manifest.webmanifest`, `sw.js` ou `ds/Header.js`.

### 1.3 Telas existentes e seus donos

O roteamento é um `switch` sobre `app.mode` em `src/app/router.js:99-103`. São três modos e, dentro de navegação, três sub-visões via `navState.view` (`NavigationScreen.js:26-32`).

| Tela | Modo / visão | Arquivo dono | CSS |
|---|---|---|---|
| Planejamento ("Home") | `app.mode === 'planning'` | `src/screens/home/HomeScreen.js` (`renderPlanning`) | `styles/screens/home.css` |
| Escolha de rota ("Escolha uma rota" / "Sua rota") | `app.mode === 'summary'` | `src/screens/routeSummary/RouteSummaryScreen.js` (`renderSummary`) | `styles/screens/route-summary.css` |
| Navegação — mapa (padrão) | `navigation` + `view === 'map'` | `src/screens/navigation/NavigationScreen.js` (`renderNavigationMap`) | `navigation.css` + `navigation-sheet.css` |
| Navegação — etapas | `navigation` + `view === 'timeline'` | `src/screens/navigation/NavigationTimeline.js` | `navigation-timeline.css` |
| Navegação — trajeto (esquemático) | `navigation` + `view === 'trajeto'` | `src/screens/navigation/NavigationRouteMap.js` | `navigation-route-map.css` |

Sobrepostos a qualquer modo (renderizados sempre, concatenados em `router.js:100-102`):

| Overlay | Arquivo dono | Gatilho |
|---|---|---|
| Busca de origem/destino | `src/components/SearchOverlay.js` | `uiState.searchOpenFor` |
| Detalhe de local (legado, por nó) | `src/components/LocationDetail.js` | `uiState.modalNodeCode` |
| Detalhe de local (rico) | `src/components/PlaceDetailSheet.js` | `uiState.placeDetailId` |
| Visão geral da rota | `NavigationScreen.js:230` (`renderOverlayOverview`) | `uiState.showOverview` |
| Ajuda | `src/app/actions.js:975` (`<dialog>` criado em runtime) | `#help-btn` |

Fora da app, servida por URL própria: **Styleguide** — `design_system.html` + `src/styleguide/styleguide.js`.

---

## 2. CONSUMO DA API — comparação com o contrato real

### 2.0 A camada HTTP

Toda chamada passa por `createHttpClient` (`src/services/api/httpClient.js:19-53`).

- Base URL: `https://api.gatesky.com.br`, fixa em `src/app/config/appConfig.js:5`, sem override por ambiente (nem `import.meta.env`, nem query param, nem `localStorage`). **Não há como apontar para localhost sem editar o arquivo.**
- Timeout: 15s via `AbortController` (`appConfig.js:6`, `httpClient.js:22-23`).
- Erros viram `SkyGateApiError` com `kind` ∈ `network | timeout | validation | not_found | server | http | invalid_response` (`httpClient.js:37-49`).
- Nenhum header de autenticação, nenhum retry, nenhum `credentials`.

Existem **apenas 2 chamadas HTTP ativas** em todo o frontend (confirmado por varredura de `fetch(` e dos wrappers em `src/`).

---

### 2.1 `GET /airports`

- **Arquivo:** `src/app/bootstrap.js:39` → `src/services/api/airportsApi.js:3`
- **Método:** GET
- **Envia:** nada (sem query string, sem headers extras — `httpClient.js:30` só adiciona `Content-Type` quando há body)

**Shape exato que o código espera receber:**

```js
// Aceita array puro OU objeto envelope. asArray (utils/format.js:5-12) tenta,
// nesta ordem: Array.isArray(v) → v.items → v.data → v.airports → v.nodes → []
[
  {
    slug?:  string,   // bootstrap.js:41-42 — filtra por === 'fortaleza', depois por includes()
    code?:  string,   // bootstrap.js:41 — fallback de slug
    id?:    string,   // selectors.js:13 (getAirportSlug) — terceiro fallback
    name?:  string,   // NUNCA LIDO em nenhum lugar
    city?:  string,   // HomeScreen.js:334 — appData.airport?.city ?? 'Fortaleza'
  }
]
```

Campos efetivamente consumidos: **apenas `slug` (ou `code`/`id`) e `city`.**

**Divergências:** o contrato fornecido não especifica o shape do item de `/airports`, então a comparação campo a campo é **não determinado**. O que dá para afirmar:

1. Se a API devolver `name` (provável), o front **ignora**: `HomeScreen.js:334` só lê `city`, e o nome exibido vem de string fixa no fallback (`bootstrap.js:43`).
2. `bootstrap.js:41-43` tem um fallback **silencioso**: se nenhum item bater com `'fortaleza'`, ele fabrica `{ slug: 'fortaleza', name: 'Aeroporto Internacional de Fortaleza', city: 'Fortaleza' }` e segue. A app nunca avisa que o aeroporto veio de literal e não da API.
3. O front é **hard-coded para um único aeroporto** (`APP_CONFIG.airportSlug` e `FORTALEZA_SLUG` em `constants.js:8`). Se `/airports` devolver 20 aeroportos, 19 são descartados sem UI de seleção.

---

### 2.2 `GET /airports/{slug}/map`

- **Arquivo:** `src/app/bootstrap.js:48` → `src/services/api/airportsApi.js:5`
- **Método:** GET
- **Envia:** `slug` no path (`encodeURIComponent`), vindo de `getAirportSlug(appData.airport)`
- **Normalizador:** `normalizeMap` (`src/services/normalize.js:11-50`)

**Shape exato que o código espera receber:**

```js
{
  nodes: [                      // normalize.js:12 — aceita nodes | points | data.nodes
    {
      node_code | code | id : string,                // normalize.js:15
      floor | floor_id | level : string|number,      // normalize.js:16
      type | category | kind : string,               // normalize.js:17
      display_name | name | label | title : string,  // normalize.js:18
      x | position_x : number,                       // normalize.js:23
      y | position_y : number,                       // normalize.js:24
      // ── TODOS OS ABAIXO SÃO LIDOS E NÃO EXISTEM NO CONTRATO ──
      image_url | photo | image : string,            // normalize.js:25
      logo_url | logo : string,                      // normalize.js:26
      phone | contact_phone : string,                // normalize.js:27
      website | url : string,                        // normalize.js:28
      opening_hours | hours : object,                // normalize.js:29
      description : string,                          // normalize.js:30
      is_accessible | isAccessible | accessible : boolean, // normalize.js:34-36
    }
  ]
}
```

**Saída do normalizador** (o shape que o resto da app consome — `appData.nodes`):
`{ code, floorId, type, name, isPoi, isInternal, isVertical, x, y, image, logo, phone, website, hours, description, isAccessible, searchText }`

`floors` **não vem da API** — é derivado dos `floor` distintos dos nós e rotulado por `FLOOR_LABELS` (`normalize.js:46-47`, `constants.js:15`).

#### Divergências — `GET /airports/{slug}/map`

**A. Campos que a API MANDA e o front IGNORA por completo (zero referências em `src/`):**

| Campo | Verificação | Impacto |
|---|---|---|
| `airport` | 0 ocorrências como leitura de `mapData.airport` | O objeto do aeroporto vindo do `/map` é descartado; a app usa o de `/airports`. |
| `edges[]` | 0 ocorrências de `edges` em todo `src/` | **O grafo do aeroporto é jogado fora.** O mapa desenha só a polilinha do `path` da rota (`floorMapBuilder.js:424-446`); corredores e conexões não são renderizados. É a razão pela qual o "mapa" é um fundo fantasma sintético (ver seção 4). |
| `businesses[]` | 0 ocorrências de `businesses` em todo `src/` | **Todos os dados comerciais são descartados na entrada.** É exatamente o que preencheria `image`, `logo`, `phone`, `website`, `hours`, `description` — campos que `normalize.js:25-30` procura *dentro de cada nó*, onde a API não os coloca. Consequência em cadeia na seção 3.1. |

**B. Campo que o front ESPERA e a API NÃO manda:**

| Campo esperado | Onde | Consequência exata |
|---|---|---|
| `is_accessible` | `normalize.js:34-36` | `node.isAccessible` é **sempre `false`** para todos os nós. Isso torna morto: o selo "Acessível" em `PlaceDetailSheet.js:123`, o selo em `LocationDetail.js:19`, o selo em `SearchOverlay.js:81`, o campo `is_accessible` em `placesMock.js:75`, e o rótulo "Acessibilidade e circulação" em `nodePresentation.js` (`getPublicNodeSubtitle` e `getPublicNodeCategory`), que sempre cai em "Circulação vertical". Cinco pontos de UI que nunca disparam. |
| `image_url`/`logo_url`/`phone`/`website`/`opening_hours`/`description` | `normalize.js:25-30` | Todos resolvem para `''`/`null`. Detalhado em 3.1. |

**C. Campos do contrato de `nodes[]` corretamente consumidos:** `id`/`code`, `name`, `type`, `floor`, `x`, `y`. O contrato lista `id` **e** `code`; `normalize.js:15` usa `first(node_code, code, id, 'n{i}')`, ou seja **prefere `code` sobre `id`** — correto para este contrato, já que `path[]` em `/routes/calculate` também identifica nós por `code`.

**D. Confirmação de campos que o front NÃO procura** (o enunciado avisa que a API não os manda, e de fato o front também não os pede): `zone`, `is_restricted`, `connector_group` — 0 referências. Sem divergência aqui.

---

### 2.3 `POST /routes/calculate`

- **Arquivo:** `src/app/routeController.js:62-71` → `src/services/api/routesApi.js:3-9`
- **Método:** POST, `Content-Type: application/json`
- **Normalizador:** `normalizeRoute` (`src/services/normalize.js:52-66`)

**O que envia (body):**

```js
{
  airport_slug:      string,   // routeController.js:63
  origin_code:       string,   // routeController.js:64
  destination_code:  string,   // routeController.js:65
  route_mode:        'fastest' | 'accessible',  // routeController.js:66
  horario_voo?:      'HH:MM',  // routeController.js:70 — só quando há horário de voo
  persist_session:   false,    // routesApi.js:7 — sempre false, nunca configurável
}
```

**Observações sobre o request:**
- `horario_voo` é o **único campo em português** num payload em inglês. O comentário em `routeController.js:67-69` admite que o endpoint pode ignorá-lo. O contrato de resposta não menciona nada derivado dele — provável campo morto. **Se a API espera outro nome, é impossível saber pelo contrato fornecido: não determinado.**
- O front **nunca envia** nada que selecione uma parada comercial. O contrato responde `selected_business`, `stop_time_minutes`, `detour_minutes`, `stop_feasible` e `route_mode` — toda a família "parar numa loja no caminho". Sem um parâmetro de entrada correspondente, essa metade da API é inacessível pela UI atual.

**Shape exato que o código espera receber:**

```js
{
  // ── LIDO ──
  total_estimated_time_minutes?: number,  // normalize.js:61 — PRIMEIRA escolha
  estimated_time_minutes?:       number,  // normalize.js:61 — fallback
  path?: Array<string | { code | node_code : string }>,  // normalize.js:57 → extractCodes:126-132
  steps?: Array<string | {...}>,          // normalize.js:59-60 → normalizeStep:91-123
  floor_segments? | floorSegments?: Array<...>,  // normalize.js:53 → normalizeSeg:68-81
  warnings?: Array<string | { message | text }>, // normalize.js:64; render em RouteSummaryScreen.js:258-265

  // ── LIDO SÓ POR routeOptions.js, E NENHUM DESSES NOMES EXISTE NO CONTRATO ──
  rotas? | alternatives? | routes? | route_options?: Array<{...}>,  // routeOptions.js:113
}
```

`normalizeRoute` guarda o payload inteiro em `route.raw` (`normalize.js:63`), mas o único consumidor de `raw` é `routeOptions.js:113`.

**Aliases aceitos por `extractCodes`** (`normalize.js:126-127`): `node_codes`, `nodeCodes`, `path_node_codes`, `pathNodeCodes`, `path`, `nodes`. O contrato usa `path` — coberto.

**Aliases aceitos por `normalizeStep`** (`normalize.js:91-123`): string pura, ou objeto com `instruction|text|title|description`, `floor|floor_id|level`, `transition.type|transition_type|transitionType|vertical_type`, `transition.to_floor|to_floor|toFloor`. O contrato manda **strings** — coberto pelo caminho de `normalize.js:92-99`.

**Aliases aceitos por `normalizeSeg`** (`normalize.js:68-81`): `{ transition: { type, from_floor, to_floor } }` ou `{ floor|floor_id|level, + extractCodes }`. **O contrato lista `floor_segments[]` sem especificar o shape do elemento — a compatibilidade é `não determinado`.** Se o elemento não expuser nem `floor`/`floor_id`/`level` nem `transition`, `normalizeSeg` devolve `null`, todos os segmentos são descartados (`normalize.js:55`) e `buildSegments` reconstrói tudo a partir de `path` + lookup de piso local (`normalize.js:58`, `:134-144`).

#### Divergências — `POST /routes/calculate`

**A. Campos que a API MANDA e o front IGNORA por completo.** Confirmado por varredura literal: **zero ocorrências em todo `src/`** para cada um destes.

| Campo do contrato | Ocorrências em `src/` | O que se perde |
|---|---|---|
| `services_on_path[]` | **0** | **A divergência mais cara.** É a lista de serviços no caminho (`name`, `category`, `estimated_stop_minutes`). A UI para exibi-la **já existe e está pronta**: `passesByRow()` em `RouteSummaryScreen.js:275-297` renderiza "Passa por X · Y · Z". Mas ela lê `option.passesBy`, que só é populado a partir de `item.passa_por`/`item.passes_by` **dentro de uma coleção `rotas`/`alternatives` que a API nunca devolve** (`routeOptions.js:132`). Resultado: componente renderizado 100% das vezes com array vazio → retorna `''`. Feature completa, morta por incompatibilidade de nome e de nível de aninhamento. |
| `selected_business` | **0** | Nunca exibido. |
| `free_time_minutes` | **0** | Nunca exibido. O front calcula folga por conta própria em `flightSlack.js:165-171`, a partir do relógio do device e de `APP_CONFIG.flight.gateCloseMargin`. **Front e backend calculam folga independentemente e podem discordar na tela.** |
| `stop_time_minutes` | **0** | Nunca exibido. |
| `detour_minutes` | **0** | Nunca exibido. `option.deltaMinutes` (`routeOptions.js:130`) procura `delta_vs_rapida_min`/`delta_minutes` — nomes que não existem no contrato — e cai em `0`. |
| `stop_feasible` | **0** | Nunca exibido. |
| `direct_estimated_time_minutes` | **0** | Nunca exibido. |
| `journey_type` | **0** | Nunca lido. Notável: `planState.flightType` (`appState.js:39`) é escolhido **manualmente pelo passageiro** na Home para definir a margem de portão (`appConfig.js:57`), enquanto a API já classifica a jornada. Dado duplicado, sem reconciliação. |
| `route_mode` (na resposta) | 1 ocorrência, mas é o **envio** (`routeController.js:66`) | O eco da API não é lido nem comparado com o que foi pedido. Se o backend rebaixar `accessible` para `fastest`, o front não percebe. |
| `origin` / `destination` (objetos da resposta) | **0** como leitura da resposta | O front usa `findNode(planState.originCode)` no cache local de `/map`. |
| `airport` (na resposta) | **0** | Descartado. |

**B. Campos que o front ESPERA e a API NÃO manda:**

| Esperado | Onde | Consequência exata |
|---|---|---|
| `rotas` \| `alternatives` \| `routes` \| `route_options` | `routeOptions.js:113` | **`normalizeApiOptions` retorna `[]` em 100% das chamadas.** `buildRouteOptions` (`:23-27`) cai sempre em `directOption(route)` (`:167-183`). Efeito em cascata: `passesBy: []` (linha 175), `deltaMinutes: 0` (174), `fits: ''` (180), `recommendedByApi: false` (181), e `serverSlackMin`/`serverStatus` sequer são definidos. **A tela de "Escolha uma rota" nunca tem mais de uma opção**, e `renderSummary` cai no título "Sua rota" (`RouteSummaryScreen.js:47,57`). Todo o aparato de comparação, ordenação por viabilidade (`routeOptions.js:88-93`), recomendação (`:95-101`), radio buttons e `#risk-ack` existe para um caso que a API não produz. |
| `tempo_min`, `passa_por`, `etapas`, `avisos`, `sugestao`, `recomendada`, `folga_min`, `status`, `pisos`, `icone`, `nome`, `delta_vs_rapida_min` | `routeOptions.js:118-143` | ~14 campos em português, inalcançáveis (estão dentro da coleção do item anterior). |
| `path[].name`, `path[].type`, `path[].x`, `path[].y` | `extractCodes` (`normalize.js:128-131`) | O contrato manda cada item de `path` com `code, name, type, x, y`. `extractCodes` **descarta tudo menos `code`**. O front então re-busca cada nó em `appData.nodes` (`selectors.js:16-18`). Não é um bug hoje, mas cria um **acoplamento duro**: se um nó de rota não estiver em `/map`, `routePathMatchesPlan` (`routeSteps.js`) rejeita a rota inteira e o usuário vê "Não foi possível encontrar um caminho", mesmo com a API tendo devolvido a rota completa com coordenadas. As coordenadas estão no payload e são jogadas fora. |

**C. Diferença de nome (mesmo dado, chave diferente):**

| Dado | Contrato | Nome que o front procura | Local |
|---|---|---|---|
| Serviços no caminho | `services_on_path` | `passa_por` / `passes_by` | `routeOptions.js:132` |
| Delta vs. mais rápida | `detour_minutes` | `delta_vs_rapida_min` / `delta_minutes` | `routeOptions.js:130` |
| Folga | `free_time_minutes` | `folga_min` | `routeOptions.js:141` |
| Coleção de rotas | *(resposta é uma rota só)* | `rotas` / `alternatives` / `routes` / `route_options` | `routeOptions.js:113` |

**D. Diferença de tipo:** nenhuma divergência de tipo detectada nos campos efetivamente lidos. `estimated_time_minutes` é coagido por `Number()` com guarda `Number.isFinite` (`normalize.js:61-63`); `steps` como strings é o caminho suportado.

**E. Divergência estrutural de maior gravidade — o guard-rail de acessibilidade.**

`isRouteCompatibleWithAccessibleMode` (`routeSteps.js`, chamado em `routeController.js:83-89`) exige, para aceitar uma rota `accessible`, que **toda transição de piso seja provada como elevador**. Ela cruza três fontes: tipos dos nós do `path`, `steps[].transitionType`/`floorId`/`toFloor`, e `segments[].transitionType`/`fromFloor`/`toFloor`.

O contrato manda `steps[]` como **strings**. Para uma string, `normalizeStep` (`normalize.js:92-99`) fixa `floorId: ''` e `toFloor: ''`, e o tipo sai de regex sobre o texto em português (`getStepTransitionType`, `routeSteps.js`). Duas falhas concretas:

1. Se um passo é detectado como transição por conter "suba"/"desça" (`normalize.js:88`) mas **não** contém "elevador", `getStepTransitionType` devolve `'transition'`, e a checagem `types.some(type => type !== 'elevator')` **rejeita a rota**.
2. Como passos-string não carregam `floorId`/`toFloor`, `stepPairs` fica vazio. Se `floor_segments[]` também não trouxer entradas `transition` no shape esperado, `elevatorPairs` fica vazio, e **qualquer** cruzamento de piso cujo nó de origem ou destino não seja `type === 'elevator'` reprova em `consumeElevatorPair`.

O usuário recebe `'Não encontramos uma rota sem escadas entre estes pontos.'` (`routeController.js:138`) para uma rota que a API entregou com sucesso. Ver risco #1.

---

### 2.4 Resumo da comparação

| | Contagem |
|---|---|
| Endpoints do contrato | 4 |
| Endpoints efetivamente chamados | 3 (`/airports`, `/airports/{slug}/map`, `/routes/calculate`) — `GET /airports/{slug}` tem wrapper mas nunca é chamado |
| Campos do contrato ignorados pelo front | **13** (`edges`, `businesses`, `airport`×2, `services_on_path`, `selected_business`, `free_time_minutes`, `stop_time_minutes`, `detour_minutes`, `stop_feasible`, `direct_estimated_time_minutes`, `journey_type`, `route_mode` na resposta, `origin`/`destination` na resposta) |
| Campos que o front espera e não existem | **~20** (`is_accessible` + 6 de negócio no nó + `rotas`/`alternatives`/`routes`/`route_options` + ~12 campos em português dentro delas) |
| Features de UI prontas mas mortas por divergência | **3** (selo "Acessível", linha "Passa por", tela de comparação de múltiplas rotas) |

---

## 3. MOCK vs REAL

### 3.1 Todo ponto que usa dado falso ou hardcoded

Não há mock server, nem fixture, nem `if (DEV) return fakeData`. `src/services/placesMock.js` conserva o nome mas, desde a refatoração documentada em seu cabeçalho (`placesMock.js:1-7`), lê apenas nós normalizados. O que existe é **dado de conteúdo embutido no código** e **fallbacks silenciosos**.

| # | Arquivo:linha | O que é | O que falta pra vir da API |
|---|---|---|---|
| 1 | `nodePresentation.js:92-152` | `_OV` — **55 entradas** mapeando códigos de nó reais do Fortaleza (`p0_elevador_a`, `p2_elevador_c`, `p3_wc`…) para nome público, subtítulo e aliases de busca. É o maior bloco de conteúdo hardcoded do repositório. | `nodes[].name` precisaria já vir apresentável, ou o `/map` precisaria devolver `display_name`, `subtitle` e `aliases[]` por nó. Hoje `normalize.js:18` já procura `display_name` — a API não manda. |
| 2 | `nodePresentation.js:169-182` | `_CORR` — 12 rótulos seguros de corredor por código de nó. | Mesmo campo `display_name` do item 1. |
| 3 | `nodePresentation.js:63-85` | `_TYPE_META` — 21 tipos × (rótulo público, ícone Solar, cor hex). | Não é problema: taxonomia de apresentação legitimamente do cliente. |
| 4 | `nodePresentation.js:155-166` | `_TYPE_ALIASES` — sinônimos de busca por tipo. | Idem. |
| 5 | `nodePresentation.js:24` e `constants.js:15` | `FLOOR_LABELS` / `_FL` — `{'0':'Térreo','1':'Piso 1','2':'Piso 2','3':'Piso 3'}`, **duplicado em dois arquivos**. Suporta no máximo 4 pisos; o 5º vira "Piso 4". | `/map` devolveria `floors[]` com `{ id, name }`. Hoje `normalize.js:46-47` deriva pisos dos nós e rotula pela tabela local. |
| 6 | `bootstrap.js:43` | Objeto de aeroporto fabricado: `{ slug:'fortaleza', name:'Aeroporto Internacional de Fortaleza', city:'Fortaleza' }`, usado quando `/airports` não devolve match. **Falha silenciosa** — a app parece funcionar. | Tratar como erro, ou aceitar o primeiro item da lista. |
| 7 | `HomeScreen.js:334` | `appData.airport?.city ?? 'Fortaleza'` — cidade fixa como fallback. | Item 6. |
| 8 | `constants.js:8` / `appConfig.js:2` | Slug `'fortaleza'` fixo em dois lugares. Não existe UI de escolha de aeroporto. | Seletor de aeroporto + slug em estado, não em constante. |
| 9 | `appConfig.js:17` | `metersPerUnit: 0.38` — **calibração empírica de UMA rota** (`p0_porta_1 → p2_portao_7`), como o próprio comentário `appConfig.js:8-14` documenta. Toda distância em metros mostrada ao passageiro (`routeSteps.js:473`) deriva disso. | `/map` devolveria escala/unidade real da planta, ou `path[]` traria distância por trecho. |
| 10 | `appConfig.js:55-60` | Margens de fechamento de portão (20 min doméstico / 40 internacional) e faixas de folga (30/10 min). `byAirport: {}` vazio. | Endpoint de configuração operacional por aeroporto, ou `free_time_minutes` da própria API — **que já vem no contrato e é ignorado** (ver 2.3.A). |
| 11 | `appConfig.js:5` | Base URL da API fixa em `https://api.gatesky.com.br`, sem override de ambiente. | Variável de ambiente ou `<meta>` no `index.html` lido em runtime. |
| 12 | `routeSteps.js:166-170` | Limiares de detecção de curva (50°, 150°, 5m, 3m, 7m). | Aceitável como heurística de cliente; só depende do item 9 estar certo. |
| 13 | `mapFit.js:35-53` | 5 constantes de enquadramento afinadas para o espaço 900×600 (`FIT_PAD_RATIO`, `FIT_PAD_MIN`, `MIN_SPAN 170`, `CAPTION_PAD 60`, `FIT_MAX_SCALE 2.6`). | Nada da API. Mas viram lixo assim que o viewBox mudar para 3740×1800 (ver 4.4). |
| 14 | `floorMapBuilder.js:30-31` | `MAP_W = 900`, `MAP_H = 600`, `MAP_PAD = 48` — o espaço de coordenadas inteiro do mapa. | Ver seção 4. |
| 15 | `floorMapBuilder.js:94, 107, 115` | `termPad = 60`, 4 faixas de zona por quartil de X, `zPad = 28` — **a "planta" é inventada**: contorno e zonas derivam de agrupar nós por quartil horizontal, não de arquitetura real. | Ver seção 4. |
| 16 | `floorMapBuilder.js:520-538` | 9 `stop-color` hex inline nos gradientes de rota/halo (`#29ABE2`, `#7FE3FF`, `#3F9FCE`, `#6FE0FF`). | Ver 5.1. |
| 17 | `router.js:96` | `theme-color` alternando entre `'#0A192F'` e `'#F4F6FA'` literais. | Ver 5.1. |
| 18 | `normalize.js:25-30` | Seis campos de negócio lidos **de dentro do nó**, onde a API não os põe — eles vivem em `businesses[]`. Todos resolvem para `''`. | Consumir `businesses[]` de `/airports/{slug}/map` e casar com os nós. Ver cadeia abaixo. |
| 19 | `PlaceDetailSheet.js:95` | Hero `is-placeholder` quando não há `photo_url`. Como `photo_url` é sempre `''` (item 18), **o placeholder é o único estado que existe**. | Item 18. |
| 20 | `nodePresentation.js:342` | `window.__sgPresentationTests = runPresentationTests` — 21 asserts de teste anexados ao `window` **em produção**, executando no load de todo cliente. | Guardar atrás de um flag de dev, ou mover para `tests/`. |

**Cadeia completa do item 18** — vale explicitar, porque é uma feature inteira parada:
`businesses[]` chega em `/map` → `normalizeMap` não olha (`normalize.js:12` só lê `nodes`) → `node.image/logo/phone/website/hours/description` = `''` → `getPlaceDetails` (`placesMock.js:63-76`) devolve tudo vazio → `PlaceDetailSheet` renderiza card sem foto, sem horário, sem contato, sem descrição, e `getOpenStatus` (`placesMock.js:90-108`) devolve sempre `{ open: null }` (nunca "Aberto agora"/"Fechado"). **Toda a UI de detalhe de estabelecimento está construída e testada (`tests/place-data.test.mjs`) mas nunca recebe dado.**

### 3.2 A camada de serviço está isolada de verdade?

**Para trocar de backend: sim. Para trocar por mock: não.**

O que está bem isolado:
- `fetch` aparece **uma única vez** em toda a aplicação (`httpClient.js:31`). Nenhuma tela, nenhum componente, nenhum módulo de estado faz IO.
- Os wrappers de endpoint estão em 3 arquivos de 3-9 linhas, com barrel em `api/index.js`.
- Toda tradução de payload está concentrada em `normalize.js`, e nenhum campo cru vaza para as telas — o resto da app só conhece `{ code, floorId, isPoi, … }`.
- `routeOptions.js:9-11` documenta explicitamente esse contrato de fronteira.
- Trocar a URL do backend é **uma linha**: `appConfig.js:5`.

O que quebra o isolamento:
1. **Não há injeção de dependência.** `httpClient.js:55` exporta um singleton já construído, e `airportsApi.js:1` / `routesApi.js:1` o importam por nome. `createHttpClient` aceita `baseUrl` e `timeoutMs` (`httpClient.js:19`) mas **nenhum call-site usa isso**. Para injetar um mock é preciso interceptar `globalThis.fetch` ou editar arquivo.
2. **Acoplamento ao browser dentro do cliente HTTP.** `httpClient.js:23` e `:40` usam `window.setTimeout`/`window.clearTimeout`. Isso torna o módulo **não importável em Node**, e é por isso que nenhuma das 9 suítes de teste toca a camada de API — nenhum teste importa nada de `src/services/api/`.
3. **Nenhum ponto de configuração em runtime.** Sem `import.meta.env`, sem `<meta name="api-base">`, sem `localStorage`. Apontar para staging exige commit.

**Veredito:** trocar o *endereço* do backend é uma linha; trocar a *implementação* por um mock exige editar `httpClient.js` ou monkey-patch global. O isolamento é bom em arquitetura de camadas e fraco em injeção.

---

## 4. MAPA

### 4.1 Como o desenho é gerado hoje

**Entrada:** só `appData.nodes` — `{ code, type, floorId, name, x, y }`. Nada mais. `edges[]` da API é descartado (2.2.A), e a rota entra como lista de `code` (`navState.route.path`).

**Pipeline** (`src/map/floorMapBuilder.js`):

```
appData.nodes filtrados por floorId
        │
        ├─► getFloorBounds(floorId)          :48-60   min/max de x,y DAQUELE piso
        │
        └─► nodeToSvg(node, bounds)          :62-77   ①  NORMALIZA para 900×600
                    │
                    ├─► buildBaseFloorSvg    :84-163  camada BASE (cacheada)
                    ├─► buildRouteOverlaySvg :394-…   camada ROTA
                    ├─► buildPoiLayerHtml    :705-716 camada POI (HTML, não SVG)
                    └─► buildLabelLayerHtml  :351-…   camada LEGENDAS (HTML)
```

**① A transformação central** (`floorMapBuilder.js:62-77`) — este é o ponto que decide tudo:

```js
const scale   = Math.min(innerW / bounds.w, innerH / bounds.h);  // innerW=804, innerH=504
const offsetX = MAP_PAD + (innerW - bounds.w * scale) / 2;
return { x: offsetX + (node.x - bounds.minX) * scale, ... };
```

Ou seja: **as coordenadas x/y da API são re-normalizadas para caber em 900×600, por piso, usando a bounding box dos nós daquele piso.** Escala única para os dois eixos (preserva ângulos), centralizada, com 48px de padding.

**As 4 camadas**, empilhadas em `NavigationScreen.js:44-62` dentro de `#map-inner`:

| Camada | Conteúdo | Como é gerado |
|---|---|---|
| `#map-base` | `rect` de fundo, **contorno do terminal** (hull dos nós + 60 de padding, `:97-100`), **4 "zonas"** (POIs agrupados por quartil de X, `:106-121`), 3 linhas divisórias, marca d'água do piso | `buildBaseFloorSvg:84-163`. Cacheado em `mapState.svgBaseCache` e **nunca reconstruído** (`getBaseFloorSvg:718-723`) |
| `#map-route` | Polilinhas da rota em 3 estados (completed/active/upcoming), cada uma com **5 traços empilhados** (3 halos + line + core, `:485-493`), gradiente direcional, marcadores de origem/atual/destino | `buildRouteOverlaySvg:394-…`. Reconstruído a cada mudança de passo (`router.js:122-129`) |
| `#map-pois` | `button` HTML posicionados com `style="left:Npx;top:Npx"` | `buildPoiLayerHtml:705-716` |
| `#map-labels` | Cápsulas de legenda HTML, com passo de layout que evita colisões (`placeLabels:229`) | `buildLabelLayerHtml:351-…` |

**Espaço de coordenadas comum:** `styles/screens/navigation.css:75-78` fixa `.sg-map-inner { width: 900px; height: 600px; }`. Como o `viewBox` dos SVGs também é `0 0 900 600`, **1 unidade SVG = 1 px CSS**, e as camadas HTML e SVG partilham o mesmo sistema. Pan/zoom aplica `translate(x,y) scale(s)` no `#map-inner` inteiro (`mapPanZoom.js:43`), movendo as 4 camadas juntas.

O comentário em `floorMapBuilder.js:10-12` é explícito: *"there is no floor plan from the backend… everything drawn here is synthesised from those coordinates."* **O "mapa" atual não é uma planta — é um contorno inventado a partir da nuvem de pontos.**

### 4.2 O código sabe renderizar SVG externo como camada de fundo?

**Não. Só pontos e linhas.**

- `buildBaseFloorSvg` (`:84-163`) monta a string SVG por template literal, elemento a elemento. Não há `image`, `use`, `href`, `fetch` de `.svg`, nem `innerHTML` de arquivo externo em nenhum ponto do módulo.
- Nenhum `fetch` fora de `httpClient.js:31`.
- `styles/screens/navigation.css:93` define `.sg-map-layer--base { transform: none; }` — a camada existe e está isolada, pronta para receber conteúdo, mas o que entra nela é sempre gerado.
- **A única infraestrutura que sugere essa intenção é `src/map/svgMapCache.js`** — `createSvgMapCache(loadSvg)` é um cache de promessas por `floorId`, exatamente o que carregaria plantas externas de forma assíncrona. **Está órfão** (só o teste importa) e a função `loadSvg` que ele receberia nunca foi escrita.

Conclusão: existe o *lugar* (camada `--base` isolada) e um *esboço de mecanismo* (`svgMapCache`), mas zero código de renderização de SVG externo.

### 4.3 Existe algum SVG de planta baixa neste repositório?

**Não. Zero arquivos `.svg`.**

Verificado por `find . -name "*.svg"` excluindo `node_modules/` e `.git/` — resultado vazio. `assets/` contém 12 arquivos, todos PNG/ICO/WEBP.

Portanto: **tamanho e viewBox de cada planta = não aplicável (não há arquivo).**

Único registro de `viewBox` no repositório:

| Local | viewBox | O que é |
|---|---|---|
| `floorMapBuilder.js:87, 132, 411, 511` | `0 0 900 600` | O mapa de piso gerado |
| `NavigationRouteMap.js:485` | `0 0 360 {altura dinâmica}` | Diagrama esquemático "trajeto" (`VB_W = 360`, `:48`) |
| `components/Icon.js:34` | `0 0 24 24` | Ícones |

**Nota importante sobre o viewBox 3740×1800 citado no pedido:** esse valor **não aparece em lugar nenhum do código** — nem em JS, nem em CSS, nem em HTML (verificado por busca literal de `3740` e `1800`). O código de hoje não tem conhecimento dele.

### 4.4 Onde mexer para colocar uma planta SVG de fundo e desenhar a rota por cima

O bloqueio central: **hoje as coordenadas x/y são re-escaladas por piso** (`nodeToSvg`). Uma planta real exige o oposto — o viewBox precisa ser o espaço nativo dos nós (3740×1800), e os nós devem ser plotados com `x`/`y` **crus**. Enquanto `nodeToSvg` normalizar, nó e planta nunca alinham.

Os pontos de alteração, em ordem:

**① `src/map/floorMapBuilder.js:30` — trocar o espaço de coordenadas**

```js
export const MAP_W = 900, MAP_H = 600;   // → 3740, 1800
```

Isso já propaga para os 4 `viewBox` gerados (`:87, :132, :411, :511`) e para `mapFit.js`, que importa `MAP_W`/`MAP_H` (`mapFit.js:6`).

**② `src/map/floorMapBuilder.js:62-77` — desativar a normalização (a mudança essencial)**

`nodeToSvg` deve virar identidade: `return { x: node.x, y: node.y }`. Com isso `getFloorBounds` (`:48-60`) deixa de ser usada para projeção (segue útil para auto-fit). É a única função que converte nó → pixel, então trocá-la realinha as **quatro** camadas de uma vez.

**③ `src/map/floorMapBuilder.js:84-163` — substituir a planta sintética pela real**

Remover o contorno hull (`:93-100`), as 4 zonas por quartil (`:102-121`), as divisórias (`:151-158`) e a marca d'água (`:160`), e emitir a planta no lugar. Para poder estilizar/re-tematizar (o CSS atual assume que tudo tem classe e nenhum `fill` inline — `floorMapBuilder.js:26-27`), inlinar o markup do SVG em vez de usar `image href`. Aí `src/map/svgMapCache.js` deixa de ser órfão: é exatamente o cache assíncrono para isso, e `getBaseFloorSvg` (`:718-723`) precisa virar `async`.

**④ `styles/screens/navigation.css:78` — o tamanho da caixa**

```css
.sg-map-inner { width: 900px; height: 600px; }   /* → 3740px / 1800px */
```

Obrigatório: mantém `1 unidade SVG = 1 px CSS`, premissa de que dependem as camadas HTML de POI e legenda (`buildPoiLayerHtml:709` posiciona com `left/top` em px). Sem isso, os SVG fazem letterbox do viewBox e os botões HTML descolam do desenho.

**⑤ `src/map/mapFit.js:35-53` — re-afinar as constantes**

`MIN_SPAN = 170`, `FIT_PAD_MIN = 40`, `CAPTION_PAD = 60` foram calibradas para 900 unidades (comentário em `:28-33`). Em 3740, a escala é ~4,15× maior; `FIT_MAX_SCALE = 2.6` e `MIN_SCALE`/`MAX_SCALE` (`constants.js:11-12`) também mudam de significado.

**⑥ Constantes visuais que escalam junto** — dimensionadas em unidades de mapa e ~4× pequenas demais no novo espaço: `mapPin` (`floorMapBuilder.js:166-171`, corpo ~19.8 unidades), `POI_NEAR_UNITS = 78` (`:637`), `charW = 12.5` do layout de legendas (`:181`), e as larguras de traço da rota, definidas em `styles/screens/navigation.css`.

**⑦ Onde a rota é desenhada — não precisa mudar**

`buildRouteOverlaySvg` (`:394`) já plota via `toSvg(n)` (a mesma `nodeToSvg`). Corrigidos ① e ②, **a rota passa a cair sobre a planta automaticamente**, sem tocar na lógica de partição de trechos nem no stack de traços.

**⑧ Assets** — criar `assets/floors/` com um SVG por `floorId` (hoje `0`,`1`,`2`,`3` conforme `FLOOR_LABELS`), todos no mesmo viewBox `0 0 3740 1800`, e adicioná-los ao `PRECACHE` do `sw.js:12`.

**Resumo:** dois arquivos concentram a mudança — `src/map/floorMapBuilder.js` (linhas 30, 62-77, 84-163) e `styles/screens/navigation.css:78`. `mapFit.js` e as constantes visuais são re-afinação. A rota e as camadas de POI/legenda seguem sem alteração, porque todas passam pela mesma função de projeção.

---

## 5. DESIGN SYSTEM

### 5.1 Os tokens são usados de fato, ou tem cor solta no código?

**Parcialmente. Existem dois sistemas de token vivos ao mesmo tempo, e o CSS legado usa muita cor solta.**

`styles/tokens.css` define **dois conjuntos**, e o próprio arquivo documenta o conflito (`tokens.css:145-163`):
- **v4**, em `:root` (linhas 27-133): `--navy-*`, `--teal-*`, `--slate-*`, `--surface-*`, `--shadow-*`, `--radius-*`
- **DS v5**, escopado em `.sg-ds` (linhas 165 em diante): `--sky-500`, `--bg`, `--text`, `--border-strong`, `--space-*`, `--text-*`, `--weight-*`

Dois nomes colidem com valores diferentes: `--navy-900` é `#0e2038` no v4 e `#0E2A6B` no DS; `--navy-800` é `#132d4a` vs `#12296A`. O DS foi mantido escopado justamente para não repintar a app (comentário em `tokens.css:150-155`). **A migração de fase 3 descrita em `tokens.css:157-159` — pôr `class="sg-ds"` no `<body>` — não aconteceu**: `index.html:23` tem `<body>` sem classe. O escopo é aplicado por tela (`HomeScreen.js:345`, `RouteSummaryScreen.js:51`, `NavigationShell.js:203`, `NavigationScreen.js:98`), o que funciona, mas mantém as duas paletas em produção.

Existe ainda um **terceiro** prefixo, declarado em `:root` dentro de um arquivo de tela: `--sg-page`, `--sg-navy-950`, `--sg-teal-600`, `--sg-teal-soft`, `--sg-text-*`, `--sg-border*` (`styles/screens/planning-v5.css:157-171`). São consumidos por `overlays.css:367, 403, 404, 408, 693, 710`, `components.css:53` e `planning.css:388, 401` — ou seja, três folhas dependem de tokens declarados numa quarta, que é a folha de uma tela morta (ver 1.2).

**Token referenciado e nunca definido** (verificado cruzando todos os `var(--x)` contra todas as declarações em `styles/`):

| Token | Uso | Efeito |
|---|---|---|
| `--teal-300` | `styles/screens/planning.css:366` (`border-color: var(--teal-300)`) | Sem fallback → declaração inválida, a borda cai para o valor herdado. Único token realmente órfão (`--map-zoom` é setado por JS em `mapPanZoom.js:47`; `--d`/`--i` são setados inline). |

#### Cores soltas em JS

| Arquivo:linha | Valor | Observação |
|---|---|---|
| `src/app/router.js:96` | `'#0A192F'` / `'#F4F6FA'` | `theme-color` do browser. Duplica `--bg-dark` e `--bg`. |
| `floorMapBuilder.js:520-522` | `#29ABE2` ×3 | Gradiente `sgHalo`. É `--sky-500` literal. |
| `floorMapBuilder.js:527-529` | `#7FE3FF`, `#29ABE2` ×2 | Gradiente `sgHaloDest`. |
| `floorMapBuilder.js:536-538` | `#3F9FCE`, `#29ABE2`, `#6FE0FF` | Gradiente direcional da rota. |
| `nodePresentation.js:64-84` | 21 hex (`#1e3a5f`, `#0d9488`, `#475569`, `#d97706`, `#7c3aed`, `#16a34a`, `#dc2626`, `#94a3b8`) | `_TYPE_META.color`. Chega ao DOM por `LocationDetail.js:53` (`style="color:${meta.color};background:${meta.color}1f"`). |
| `nodePresentation.js:88` | `#94a3b8` | Cor do tipo desconhecido. |

**Nota sobre `floorMapBuilder.js:520-538`:** contradiz diretamente o princípio declarado no cabeçalho do próprio arquivo (`:26-27`): *"Paint lives in CSS: every generated element carries a class and no inline fill/stroke."* Os `stop-color` de gradiente são a exceção não documentada. `stop-color` aceita `var()`, então é uma correção viável.

#### Cores soltas em CSS (~50 declarações fora de `tokens.css`)

| Arquivo | Linhas | Exemplos |
|---|---|---|
| `styles/overlays.css` | 136, 157, 164, 208, 209, 212, 216, 222, 233, 276, 278, 285, 288, 303, 403, 405, 710 | `#d3dbe5`, `#dde4ec`, `#cbd5e1`, `#eef2f7`, `#47597a`, `#64748b`, `#a5ded4`, `#e8edf3`, `#eaeff5`, `#16355a`, `#dfe6ee`, `#f6f9fc`, `#cbd7e4`, `#fef3c7`, `#b45309`, `#197c76` |
| `styles/components.css` | 102, 105, 133, 160, 162, 174, 191, 192, 210 | `#FFFFFF` ×6, `#EAF0FA` ×2 — **no DS "oficial"** |
| `styles/screens/home.css` | 583, 597, 667, 823, 864, 880 | `#94A3B8`, `#fff` ×2, `#E8EDF5`, `#FFFFFF`, `#06263A` |
| `styles/a11y.css` | 16, 17, 37, 38, 52, 53 | `#FFFFFF`, `#0A192F`, `#000000` ×2, `#4a5b73` ×2 |
| `styles/base.css` | 9, 11 | `#F4F6FA`, `#0A192F` — duplicam `--bg` e `--bg-dark` |
| `styles/screens/planning-v5.css` | 422 e outras | `#ffffff` dentro de blocos `!important` |

`styles/screens/route-summary.css`, `navigation-sheet.css`, `navigation-timeline.css` e `navigation-route-map.css` são **limpos** — só tokens, conforme anunciado em `styles/index.css:17-28`. As folhas mais recentes seguem o sistema; o legado (`overlays.css`, `planning*.css`) não.

### 5.2 Componentes do DS que existem mas ninguém usa

`src/components/ds/index.js` exporta 9 símbolos. Verificação de call-sites reais (`Nome({`) fora de `ds/` e do styleguide:

| Componente | Status | Onde é usado |
|---|---|---|
| `dsIcon` | usado | 6 arquivos |
| `Button` | usado | `HomeScreen.js`, `NavigationScreen.js:186`, `RouteSummaryScreen.js` |
| `IconButton` | usado | `HomeScreen.js:211`, `NavigationScreen.js:179`, `ds/Header.js:54,57` |
| `Card` | usado | `HomeScreen.js:269` |
| `Chip` | usado | `HomeScreen.js:52`, `PlaceDetailSheet.js:121`, `RouteSummaryScreen.js` |
| `Header` | usado | `HomeScreen.js:347` |
| `StepRail` | usado | `NavigationScreen.js:140` |
| **`Metric` / `MetricGroup`** | **NÃO USADOS** | Só `styleguide.js:202-205, 245-248` |
| **`Sheet`** | **NÃO USADO** | Só `styleguide.js:224, 228` |

`ds/Metric.js` (36 linhas) e `ds/Sheet.js` (28 linhas) existem, são precacheados pelo `sw.js:51-52` e demonstrados no styleguide, mas **nenhuma tela os instancia**. O caso do `Sheet` é o mais notável: a tela de navegação tem um bottom sheet real, e ele é markup manual em `NavigationScreen.js:97-102` (`class="sg-ds sg-navsheet sg-instruction-card"`), não o componente do DS. O trio tempo/passos/piso que o `MetricGroup` foi feito para exibir também é markup próprio (`sg-navsheet__status`, `NavigationScreen.js:135-138`).

**Consequência prática:** o styleguide em `design_system.html` **mostra dois componentes que não representam a app**, e o `Sheet` do DS pode divergir visualmente do sheet real sem que ninguém perceba.

### 5.3 Valores de tamanho/espaçamento hardcoded que atrapalham ajustar a escala em mobile

#### A. `font-size` em px (não escala com a preferência de fonte do usuário)

O DS define uma escala tipográfica em `rem` (`tokens.css`: `--text-xs: 0.75rem` até `--text-3xl: 2.25rem`). O CSS legado a ignora. Contagem de `font-size: Npx` por folha:

| Arquivo | Ocorrências |
|---|---|
| `styles/screens/planning.css` | **66** |
| `styles/overlays.css` | **38** |
| `styles/screens/planning-v5.css` | **38** |
| `styles/screens/navigation.css` | 15 |
| `styles/screens/route-summary.css` | 15 |
| `styles/screens/home.css` | 13 |
| `styles/screens/navigation-timeline.css` | 10 |
| `styles/components/place-detail.css` | 7 |
| `styles/components.css` | **6** ← no DS "oficial" |
| `navigation-sheet.css` / `navigation-route-map.css` / `tokens.css` | 6 / 2 / 1 |
| **Total** | **~217** |

`html { -webkit-text-size-adjust: 100% }` (`tokens.css:10`) fecha a porta restante: nenhuma dessas fontes responde ao tamanho de texto do sistema. **É o maior obstáculo de escala em mobile e um problema de acessibilidade (WCAG 1.4.4).**

#### B. `!important` — a barreira de override

| Arquivo | Ocorrências |
|---|---|
| `styles/screens/planning-v5.css` | **149** |
| `styles/a11y.css` | 11 (legítimo: overrides assistivos, `index.css:29-30`) |
| `styles/tokens.css` | 4 (legítimo: `prefers-reduced-motion`, `tokens.css:136-143`) |
| `styles/components/place-detail.css` | 7 |
| `styles/screens/home.css` / `base.css` / `planning.css` | 2 / 2 / 1 |

`planning-v5.css` sozinho concentra 149. Como `.sg-planning` não é mais renderizado (1.2), muitos são inertes — mas os que atingem classes ainda vivas travam qualquer ajuste. `planning-v5.css:182-187` força `height: auto !important`, `min-height: 100dvh !important`, `overflow-y: auto !important`; `:420-424` e `:452-454` cravam `width: 22px !important; height: 22px !important` em elementos de toggle.

`styles/screens/home.css:11` e `:902` documentam o combate: comentários explicando que a Home foi construída com classe própria **para escapar de um `width: 122px !important`** que `planning-v5.css` ainda impõe a `.sg-quick-card`. A dívida já está custando nome de classe.

#### C. Dimensões fixas em px

| Local | Valor | Por que atrapalha |
|---|---|---|
| `navigation.css:78` | `.sg-map-inner { width: 900px; height: 600px }` | Caixa fixa maior que qualquer viewport de telefone. O comentário `:69-72` explica que era proposital (evitar letterbox), mas fixa o mapa a um tamanho de canvas. |
| `home.css:568-569` | `52px` × `48px` | |
| `home.css:594-595`, `664-665`, `811-812` | `26px`, `17px`, `16px` | |
| `home.css:874-875`, `924-925` | `40px`, `60px` | |
| `home.css:55` | `height: 46px` (logo) | |
| `tokens.css:76-82` | `--header-h: 56px`, `--tap-min: 48px`, `--sidebar-w: 380px`, `--card-max-w: 480px`, `--instr-card-h: 148px` | Tokenizados (bom), mas em px absoluto — mudar a escala global exige mexer nos tokens, não numa raiz. |
| `mapFit.js:35-53`, `floorMapBuilder.js:30-31, 94, 115, 181, 637` | Constantes de geometria em JS | Fora do alcance do CSS: nenhum media query os alcança. |

Só duas quebras responsivas existem em `home.css` (`@media (max-width: 400px)` na linha 780 e `(max-width: 350px)` na 895), e a segunda ajusta um único elemento (`:896`).

**Onde começar, se o objetivo é escala em mobile:** não há uma variável de escala global. O ponto único mais barato seria introduzir um `--scale` em `:root` e converter os `font-size: Npx` de `overlays.css` (38) + `navigation.css` (15) + `route-summary.css` (15) + `home.css` (13) — as folhas que realmente renderizam — para a escala em `rem` já definida. `planning.css`/`planning-v5.css` (104 ocorrências) são majoritariamente código morto e deveriam ser removidos, não convertidos.

---

## 6. RISCOS

Os 5 problemas mais graves, ordenados por gravidade — impacto no passageiro × probabilidade de ocorrer.

---

### #1 (crítico) — O modo "Acessível" rejeita rotas válidas que a API entregou com sucesso

**`src/services/routeSteps.js`** (`isRouteCompatibleWithAccessibleMode`) — chamado em **`src/app/routeController.js:83-89`**

A guarda exige que **toda** transição de piso seja provada como elevador, cruzando `path[].type`, `steps[].transitionType/floorId/toFloor` e `segments[].transitionType/fromFloor/toFloor`. Mas o contrato manda **`steps[]` como strings**, e `normalize.js:92-99` fixa `floorId: ''` e `toFloor: ''` para strings, derivando o tipo por regex de português.

Dois caminhos concretos de falso negativo:
1. Um passo detectado como transição por conter "suba"/"desça" (`normalize.js:88`) mas sem a palavra "elevador" → `getStepTransitionType` devolve `'transition'` → `types.some(type => type !== 'elevator')` → **rota rejeitada**.
2. Passos-string não carregam `floorId`/`toFloor`, então `stepPairs` fica vazio. Se `floor_segments[]` não trouxer entradas `transition` no shape que `normalizeSeg` (`normalize.js:68-81`) reconhece, `elevatorPairs` fica vazio e **todo** cruzamento de piso sem nó `type === 'elevator'` numa das pontas reprova em `consumeElevatorPair`.

O erro lançado (`routeController.js:85`) vira `'Não encontramos uma rota sem escadas entre estes pontos.'` (`:138`).

**Por que é o #1:** atinge exatamente o usuário com mobilidade reduzida, é indistinguível de "não existe rota", e a rota **existe** — a API a devolveu. A validação do cliente é mais estrita que a garantia do servidor, e a única evidência é um `console.error` (`:119`).

---

### #2 (crítico) — `businesses[]` e `services_on_path[]` são descartados na entrada, matando duas features completas

**`src/services/normalize.js:12`** (só lê `nodes`) e **`src/services/routeOptions.js:113`** (procura `rotas`/`alternatives`/`routes`/`route_options`)

Duas coleções que a API manda e o front nunca abre:

- **`businesses[]`** — `normalize.js:25-30` procura os seis campos comerciais (`image_url`, `logo_url`, `phone`, `website`, `opening_hours`, `description`) **dentro de cada nó**, onde não estão. Todos resolvem `''`. Cascata: `getPlaceDetails` (`placesMock.js:63-76`) devolve tudo vazio → `PlaceDetailSheet` renderiza sempre `is-placeholder` (`:95`), sem foto, horário, contato ou descrição → `getOpenStatus` (`placesMock.js:90-108`) sempre `{ open: null }`, nunca "Aberto agora".
- **`services_on_path[]`** — a UI está pronta: `passesByRow()` (`RouteSummaryScreen.js:275-297`) renderiza "Passa por X · Y · Z" com estado aberto/fechado. Lê `option.passesBy`, populado só de `passa_por`/`passes_by` **dentro** da coleção inexistente (`routeOptions.js:132`). Sempre `[]`, sempre retorna `''`.

**Por que é o #2:** duas features construídas, estilizadas (`styles/components/place-detail.css`, 391 linhas) e testadas (`tests/place-data.test.mjs`), que nunca recebem dado. A API já entrega tudo. É trabalho pago e não entregue, e nada no código sinaliza a lacuna.

---

### #3 (alto) — A tela de escolha de rota existe para um caso que a API não produz

**`src/services/routeOptions.js:112-165`** (`normalizeApiOptions`) e **`src/screens/routeSummary/RouteSummaryScreen.js`** (362 linhas)

`normalizeApiOptions` procura `raw.rotas | alternatives | routes | route_options` (`:113`). O contrato devolve **uma rota, sem coleção**. Logo `list.length === 0` → retorna `[]` (`:115`) → `buildRouteOptions` cai sempre em `directOption(route)` (`:26`, `:167-183`), com `passesBy: []`, `deltaMinutes: 0`, `fits: ''`, `recommendedByApi: false`.

Fica morto: comparação de opções, ordenação por viabilidade (`:88-93`), escolha de recomendada (`:95-101`), radio buttons (`RouteSummaryScreen.js:207`), badge "Recomendada para você" (`:214`), `#risk-ack`, e o próprio título — `hasAlternatives` é sempre `false`, então a tela sempre diz "Sua rota" (`:47, :57`). São ~14 campos em português (`:118-143`) que nenhum contrato documenta.

Agravante: **`free_time_minutes` vem da API e é ignorado**, enquanto `flightSlack.js:165-171` recalcula folga do zero com margens fixas (`appConfig.js:55-60`). Front e backend podem mostrar números diferentes para a mesma coisa, e o número exibido é o do cliente.

**Por que é o #3:** uma tela inteira e um serviço de 227 linhas escritos contra um contrato que não é o real. Grave, mas degrada com elegância — o passageiro vê uma rota correta, só não vê escolha.

---

### #4 (alto) — `is_accessible` não existe no contrato, e o selo "Acessível" nunca aparece

**`src/services/normalize.js:34-36`**

```js
isAccessible: r?.is_accessible === true || r?.isAccessible === true || r?.accessible === true,
```

O contrato é explícito: `nodes[]` **não tem** `is_accessible`. As três variantes falham → `node.isAccessible` é **sempre `false`**, para todos os nós, sempre.

Cinco pontos de UI que nunca disparam:
- `PlaceDetailSheet.js:123` — selo "Acessível"
- `LocationDetail.js:19` — mesmo selo, sheet legado
- `SearchOverlay.js:81` — indicador na busca
- `placesMock.js:75` — campo `is_accessible` do detalhe
- `nodePresentation.js` (`getPublicNodeSubtitle` / `getPublicNodeCategory`) — rótulo "Acessibilidade e circulação" sempre cai em "Circulação vertical"

O comentário em `normalize.js:31-33` afirma que acessibilidade é *"um fato operacional, não algo que inferimos do tipo do nó"* — princípio correto, mas o fato operacional nunca chega. **Uma informação de acessibilidade ausente é indistinguível de "não é acessível"**, e o passageiro que precisa dela não recebe sinal nenhum.

---

### #5 (médio) — Três módulos órfãos, com um deles duplicando função homônima em uso

**`src/services/semanticStepBuilder.js`**, **`src/state/createStore.js`**, **`src/map/svgMapCache.js`**

Nenhum é importado pela aplicação — apenas por `tests/state-and-map.test.mjs:2-4`.

O caso perigoso é `semanticStepBuilder.js`: ele exporta **`buildSemanticSteps`**, exatamente o mesmo nome da função que a app realmente usa, vinda de `routeSteps.js` (importada em `routeController.js:9` e `actions.js:34`). Duas implementações do mesmo nome, e o teste exercita **a que não roda em produção**. Um autocomplete de IDE escolhendo o import errado troca silenciosamente o comportamento da navegação, e a suíte continua verde.

`createStore.js` é uma store com `subscribe` que nunca foi adotada — o estado real são objetos mutáveis exportados (`appState.js`), sem reatividade. `svgMapCache.js` é o cache assíncrono de SVG por piso que seria a base para carregar plantas externas (4.2) — órfão, e o `loadSvg` que ele receberia nunca foi escrito.

**Por que é o #5:** não quebra nada hoje. É risco de manutenção — código que parece coberto por teste e não está, e um teste que dá confiança falsa sobre a construção de passos, que é o núcleo das instruções de navegação.

---

### Menções honrosas (abaixo do top 5)

| Item | Local | Nota |
|---|---|---|
| Service worker cacheia a API sem TTL | `sw.js:5-11, 108-130` | `https://api.gatesky.com.br` está em `TRUSTED_RUNTIME_ORIGINS`, servido stale-while-revalidate. `RUNTIME_CACHE_NAME = 'skygate-runtime-v1'` nunca é purgado nem versionado por conteúdo — o mapa do aeroporto pode ficar servindo versão antiga indefinidamente na primeira pintura. |
| Testes rodam em produção | `nodePresentation.js:342` | `window.__sgPresentationTests = runPresentationTests` — 21 asserts anexados ao `window` de todo cliente. |
| Base URL sem override de ambiente | `appConfig.js:5` | Apontar para staging/local exige commit. |
| Cache de SVG base nunca invalidado | `floorMapBuilder.js:718-723` | `mapState.svgBaseCache` é preenchido uma vez e nunca limpo ("never rebuilt", `appState.js:66`). Correto hoje, porque os nós não mudam em sessão; vira bug no dia em que mudarem. |
| ~1.500 linhas de CSS morto | `planning.css` (608) + `planning-v5.css` (908) | `.sg-planning` tem zero referências em JS; ainda importados (`index.css:8,12`) e precacheados (`sw.js:23-24`). |
| Tokens `--sg-*` declarados numa folha morta | `planning-v5.css:157-171` | `overlays.css`, `components.css` e `planning.css` dependem deles; remover a folha morta quebra três outras. |
| `FLOOR_LABELS` duplicado | `constants.js:15` e `nodePresentation.js:24` | Mesma tabela em dois arquivos; podem divergir sem aviso. |
| `getAirport(slug)` nunca chamado | `airportsApi.js:4` | `GET /airports/{slug}` não é consumido. |
| Fallback silencioso de aeroporto | `bootstrap.js:41-43` | Objeto literal fabricado quando `/airports` não bate; a app segue como se tudo estivesse certo. |
| `--teal-300` indefinido | `planning.css:366` | Declaração CSS inválida. |

---

## Apêndice — o que não foi possível determinar

| Item | Motivo |
|---|---|
| Shape do item de `GET /airports` | O contrato fornecido não o especifica. Documentado em 2.1 o que o front espera. |
| Shape do elemento de `floor_segments[]` | O contrato lista o campo sem detalhar o elemento. Os dois shapes que `normalizeSeg` aceita estão em 2.3. |
| Se `horario_voo` é um parâmetro válido do request | O contrato não descreve o body de `POST /routes/calculate`. |
| Se `GET /airports/{slug}` teria consumidor futuro | Wrapper existe, nunca é chamado. |
| Tamanho e viewBox de plantas SVG | Não há nenhum arquivo `.svg` no repositório. |
| Origem do viewBox 3740×1800 | O valor não aparece em nenhum arquivo do repositório. |

---

## Metodologia

Auditoria estática, somente leitura. Nenhum arquivo do projeto foi modificado; a app não foi executada e nenhuma requisição foi feita à API — as afirmações sobre respostas do backend vêm do contrato fornecido no pedido, não de observação em runtime.

Técnicas: leitura integral dos arquivos de API, estado, mapa e normalização; varredura literal de cada campo do contrato em `src/`; grafo de imports para detectar órfãos; cruzamento de todos os `var(--x)` contra todas as declarações em `styles/`; diff do `PRECACHE` do `sw.js` contra os arquivos em disco (resultado: completo, só `styleguide.js` de fora, o que é correto).
