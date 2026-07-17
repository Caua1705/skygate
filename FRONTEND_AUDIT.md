# SkyGate Frontend Audit

Data da auditoria: 2026-07-17

Escopo: auditoria do frontend existente antes de refatorar. Nenhum arquivo de implementação foi alterado nesta etapa.

## 1. Estrutura de Arquivos

### Raiz do frontend

- `index.html`
  - Documento HTML principal.
  - Contem Tailwind CDN, Iconify CDN, CSS inline extenso e HTML legado de uma experiencia anterior.
  - Ao final carrega `app.js` via modulo ES.
  - O `main` e recriado por JavaScript em runtime, entao grande parte do HTML dentro de `main` hoje e legado/inicial e nao representa a UI final renderizada.

- `app.js`
  - Controlador principal do aplicativo.
  - Contem estado, normalizacao da API, renderizacao de UI, mapa SVG, jornadas, selecao de origem/destino, calculo de rota e listeners.
  - Arquivo grande e monolitico.

- `api.js`
  - Client central da API.
  - Define `API_BASE_URL`.
  - Encapsula `fetch`.
  - Expoe `getAirports`, `getAirport`, `getAirportMap`, `calculateRoute`.
  - Forca `persist_session: false` em `calculateRoute`.

- `assets/logo.jpeg`
  - Logo do SkyGate usada pelo HTML.

- `assets/design_system.html`
  - Referencia visual extensa, nao usada diretamente pelo app atual.

- `CLAUDE.md` e `system_prompt.md`
  - Documentos de instrucao/contexto de produto.
  - Nao sao codigo runtime.

### CSS

- Nao ha CSS/SCSS separado.
- Estilos estao majoritariamente em:
  - Tailwind classes no HTML gerado por `app.js`.
  - CSS inline em `index.html`.
  - Configuracao Tailwind inline em `index.html`.
- Ha estilos legados em `index.html` para elementos que hoje sao parcialmente substituidos pelo render do `app.js`.

### Componentes

- Nao ha componentes em arquivos separados.
- As secoes de UI sao funcoes de renderizacao dentro de `app.js`, por exemplo:
  - `renderHeader`
  - `renderPlannerPanel`
  - `renderJourneySelector`
  - `renderSearchInput`
  - `renderMapPanel`
  - `renderRoutePanel`
  - `renderSteps`

### Services/API client

- Existe `api.js`.
- E o ponto correto para centralizar URL e chamadas HTTP.
- Ainda ha um contrato divergente entre frontend e backend para o payload de rota. Ver secao "Contrato da API".

## 2. Fluxo Atual

### Carregamento do aeroporto

1. `init()` define `state.loading = 'airports'`.
2. Renderiza estado de loading.
3. Chama `getAirports()`.
4. Seleciona Fortaleza por slug, com fallback para `{ slug: 'fortaleza' }`.

### Carregamento do mapa

1. `init()` define `state.loading = 'map'`.
2. Chama `getAirportMap(getAirportSlug(state.airport))`.
3. Normaliza floors e nodes via `normalizeMap`.
4. Define o primeiro piso como `selectedFloorId`.

### Selecao de piso

- Pisos sao derivados de `nodes[].floor` quando `map.floors` nao existe.
- `renderFloorSelector()` renderiza botoes horizontais.
- `floor-btn` atualiza `state.selectedFloorId`.
- Quando ha rota, `route-floor-btn` tambem troca o piso selecionado.

### Selecao da jornada

- `state.journey` inicia em `embarque`.
- `JOURNEYS` define labels e comportamento para:
  - `embarque`
  - `conexao`
  - `chegada`
- `renderJourneySelector()` renderiza tres botoes.
- `selectJourney()` troca jornada, limpa busca, limpa notice, limpa rota e remove horario quando a jornada nao usa horario.

Observacao: o requisito atual fala "chegada ao destino"; o codigo usa `chegada`.

### Origem e destino

- `originCode` e `destinationCode` guardam o `code` real do node.
- UI mostra `node.name`, nao mostra `node.code`.
- Busca e sugestoes usam `state.nodes`.
- `filterSearchableNodes()` filtra por `searchText`.
- Sugestoes por jornada usam termos configurados em `SUGGESTION_TERMS`.

### Modo de rota

- `routeMode` pode ser:
  - `fastest`
  - `accessible`
- O toggle chama `renderModeButton`.
- Alterar modo limpa a rota existente.

### Calculo

- `handleCalculate()` chama `calculateRoute`.
- Payload atual em `app.js`:
  - `airport_slug`
  - `from_node_code`
  - `to_node_code`
  - `route_mode`
  - `persist_session: false`
- `api.js` tambem injeta `persist_session: false`.

### Renderizacao do resultado

- `normalizeRoute()` tenta aceitar formatos diferentes de resposta.
- `renderRoutePanel()` mostra:
  - tempo estimado
  - modo
  - quantidade de passos
  - piso atual
  - aviso de tempo apertado/confortavel quando ha horario
  - proximo passo
  - segmentos por piso
  - lista de passos
- `renderSvgMap()` desenha rota do piso selecionado.

### Persistencia de sessao

- O frontend envia `persist_session: false` no `app.js`.
- O client tambem forca `persist_session: false` em `api.js`.
- Isso atende o requisito de nao gravar `route_sessions` no uso normal.

## 3. Estados Existentes

### Implementados

- `loading = 'airports'`
  - Exibe loading de aeroportos.

- `loading = 'map'`
  - Exibe loading de mapa.

- `loading = 'route'`
  - Desabilita CTA e troca label para "Calculando rota...".

- `error`
  - Exibe card de erro geral.

- empty map
  - Quando `state.map` existe mas `state.nodes` esta vazio.

- selecione origem/destino
  - Quando nao ha rota, `renderRoutePanel()` orienta selecionar origem/destino.

- route calculated
  - Quando `state.route` existe, renderiza resumo, mapa e passos.

- route not found
  - Quando resposta nao tem steps nem path/node codes.

### Ausentes ou incompletos

- Navigation mode real
  - Nao ha estado dedicado de navegacao passo a passo.
  - O "proximo passo" e sempre o primeiro step.

- Completed
  - Nao ha estado de finalizacao/conclusao.

- Estado de busca vazio por jornada
  - Existe vazio generico "Nenhum ponto encontrado", mas nao orienta o usuario por jornada.

- Estado de erro por CORS/contrato
  - Erros de rede/422 caem em mensagem generica.

- Estado de mapa muito grande/denso
  - O mapa renderiza muitos nodes e nao tem estrategia de zoom, clustering ou foco.

## 4. Problemas de UI/UX

### Excesso de cards e camadas

- O app combina header, mapa, painel de rota, painel fixo inferior e cards internos.
- No mobile, ha competicao entre mapa e painel fixo inferior.
- O resultado da rota aparece abaixo do mapa, mas o CTA fica fixo embaixo; isso reduz area util vertical.

### Mapa fora da area principal

- A intencao mobile deveria ser mapa como area principal.
- Atualmente o mapa divide prioridade com o painel de planejamento e com o painel de resultado.
- O mapa nao tem controles de foco para origem/destino/proximo ponto.

### Formulario ocupando a tela

- O painel fixo inferior contem jornada, dois campos, horario, scan, modo e CTA.
- Em telas 390-430px, o painel pode ocupar grande parte da viewport.
- Isso reduz visibilidade do mapa e dos passos.

### Informacoes redundantes

- Jornada aparece no header do painel e tambem nos botoes.
- Piso aparece no mapa, seletor de piso e segmento de rota.
- O resultado mostra quantidade de passos e tambem lista de passos sem diferenciar estado de navegacao.

### Controles de piso

- Ha dois conceitos:
  - todos os pisos do aeroporto
  - pisos/segmentos da rota
- Ambos podem aparecer no mapa.
- Isso pode confundir o usuario, especialmente quando rota cruza piso.

### Chips e sugestoes

- Sugestoes rapidas por jornada sao uteis, mas hoje selecionam o primeiro match automaticamente.
- Isso pode escolher um destino incorreto quando ha muitos nodes similares, por exemplo muitos portoes ou banheiros.

### Botao desabilitado

- Botao desabilita sem explicar de forma contextual todos os casos.
- Ha mensagem generica "Selecione origem e destino para calcular".
- Nao diferencia "origem e destino iguais".

### Hierarquia visual

- A hierarquia esperada deveria ser:
  1. aeroporto/piso atual
  2. mapa
  3. origem/destino/jornada
  4. CTA
  5. resultado/proximo passo
- Hoje a hierarquia alterna entre formulario, mapa e resultado.

### Mobile

- Mobile-first existe no sentido de painel bottom-fixed e botoes grandes.
- Mas a composicao ainda nao resolve o espaco vertical.
- A busca abre dropdown absoluto dentro do painel fixo, com risco de ficar cortado ou cobrir controles.
- O mapa SVG escala, mas nao ha pan/zoom nem foco.

### Desktop

- Usa grid `lg:grid-cols-[minmax(0,1fr)_360px]`.
- Desktop nao quebra, mas parece uma adaptacao do mobile, nao uma experiencia otimizada.

### Acessibilidade

- Pontos positivos:
  - botoes com altura adequada.
  - uso de `role="radiogroup"` e `role="radio"` em jornadas/modo.
  - estados com `role="status"`.
- Problemas:
  - inputs de busca nao tem `label for`/`id` real.
  - dropdown de busca nao usa combobox/listbox semantics.
  - mapa SVG tem `role="img"`, mas nodes nao sao navegaveis/interativos.
  - foco pode ser perdido por re-render completo do `main`.
  - estados visuais dependem fortemente de cor.

### Consistencia visual

- Tailwind inline e CSS legado convivem.
- Alguns textos estao sem acento por ASCII.
- O design oscila entre produto premium e prototipo tecnico.

## 5. Problemas Tecnicos

### Arquivo monolitico

- `app.js` concentra:
  - estado
  - normalizacao
  - renderizacao
  - handlers
  - contrato da API
  - formatadores
  - regras de UX
- Isso dificulta refatoracao segura.

### Funcoes grandes e muitas responsabilidades

- `renderPlannerPanel`, `renderMapPanel`, `renderRoutePanel`, `normalizeRoute`, `normalizeMap` misturam UI e regra de dominio.

### Estado central simples, mas acoplado

- `state` e unico e global no modulo.
- Isso e aceitavel para MVP, mas hoje tudo re-renderiza ao menor evento.
- Re-render completo recria DOM e listeners.

### Listeners recriados em todo render

- `bindEvents()` reanexa listeners apos recriar `main`.
- Funciona porque o DOM antigo e descartado, mas aumenta risco de foco perdido e comportamento dificil em inputs/dropdowns.

### Manipulacao direta excessiva do DOM

- UI e montada por template strings.
- Isso e simples, mas com 900+ linhas fica fragil.
- Risco de erro em strings e interpolacoes.

### CSS duplicado/legado

- `index.html` ainda tem muito CSS e HTML que nao corresponde ao runtime atual.
- Isso aumenta peso e confusao.

### URLs hardcoded

- `api.js` centraliza `API_BASE_URL`, o que e bom.
- Ha fallback local em `api.js`, tambem centralizado.
- Nao ha URL espalhada em `app.js`.

### Dados mockados

- Nao ha mock runtime de airports/map/routes.
- Ainda ha HTML inicial legado em `index.html` com opcoes e mapa estatico, mas ele e substituido pelo render do `app.js`.
- Esse HTML legado deve ser removido numa fase futura para reduzir risco/confusao.

### Logica de rota refeita no frontend

- O frontend nao calcula shortest path.
- Mas ele tenta reconstruir segmentos por piso se `floor_segments` nao vier:
  - `groupRouteByFloor(routeNodeCodes)`
- Isso pode divergir do backend, especialmente para transicoes.

### Risco de inconsistencia com backend

- Alto. O payload atual do frontend usa `from_node_code` e `to_node_code`.
- A API publica testada exige `origin_code` e `destination_code`.
- Isso causa erro 422 no calculo real.

## 6. Contrato da API

### Endpoints testados

- `GET /airports`
  - Retorna lista com:
    - `id`
    - `name`
    - `slug`
    - `city`
    - `country`
    - `is_active`

- `GET /airports/fortaleza/map`
  - Retorna:
    - `airport`
    - `nodes`
    - `edges`
    - `businesses`

Resumo observado:

- nodes: 233
- edges: 255
- businesses: 0
- floors:
  - 0: 25 nodes
  - 1: 69 nodes
  - 2: 131 nodes
  - 3: 8 nodes

Campos de node:

- `id`
- `code`
- `name`
- `type`
- `floor`
- `x`
- `y`

Campos de edge:

- `id`
- `from_node_id`
- `to_node_id`
- `walk_time_minutes`
- `distance_meters`
- `instruction`
- `is_accessible`
- `edge_type`
- `is_bidirectional`
- `is_estimated`
- `accessible`
- `weight_seconds`

### Campos usados pelo frontend

De `airports`:

- `slug`
- `name`
- `code`/`id` como fallback

De `map.nodes`:

- `code`
- `id` como fallback
- `name`
- `type`
- `floor`
- `x`
- `y`

De `map.edges`:

- Ignorado pelo frontend atual.

De `businesses`:

- Ignorado pelo frontend atual.

### Rota: contrato observado

Teste com payload usando `from_node_code`/`to_node_code` retornou 422:

- campos exigidos:
  - `origin_code`
  - `destination_code`

Teste com payload aceito:

- `airport_slug`
- `origin_code`
- `destination_code`
- `route_mode`
- `persist_session: false`

Resposta observada:

- `airport`
- `journey_type`
- `origin`
- `destination`
- `estimated_time_minutes`
- `free_time_minutes`
- `path`
- `steps`
- `services_on_path`
- `route_mode`
- `direct_estimated_time_minutes`
- `stop_time_minutes`
- `total_estimated_time_minutes`
- `detour_minutes`
- `stop_feasible`
- `selected_business`
- `floor_segments`
- `warnings`

Formato observado:

- `steps` e array de strings.
- `floor_segments` e array com entradas de piso e entradas de transicao.
- Segmento de piso:
  - `floor`
  - `nodes`
- Segmento de transicao:
  - `transition`
    - `type`
    - `from_floor`
    - `to_floor`

### Campos ignorados da rota

- `estimated_time_minutes` nao e lido pelo normalizador atual.
- `total_estimated_time_minutes` nao e lido pelo normalizador atual.
- `path` pode nao ser lido se nao bater com os fallbacks esperados.
- `warnings` nao sao exibidos.
- `services_on_path` nao sao exibidos.
- `transition` em floor_segments nao e tratado corretamente como item sem `floor`.

### persist_session

- `app.js` envia `persist_session: false`.
- `api.js` injeta `persist_session: false`.
- O requisito esta atendido, apesar de duplicado.

### O frontend calcula caminho por conta propria?

- Nao calcula grafo/shortest path.
- Porem deriva `floor_segments` se eles nao existirem.
- Isso deve ser removido ou isolado como fallback defensivo, porque a fonte de verdade deve ser a resposta do backend.

## 7. Principais Riscos

1. Contrato de rota divergente: frontend envia `from_node_code/to_node_code`, API exige `origin_code/destination_code`.
2. Normalizador de rota nao cobre os campos reais `estimated_time_minutes` e `total_estimated_time_minutes`.
3. `steps` reais sao strings, mas o frontend trata tambem como objetos; isso funciona parcialmente, mas gera dados pobres.
4. `floor_segments` reais incluem itens de transicao sem `floor`, e o frontend assume `floorId`.
5. HTML/CSS legado em `index.html` pode induzir manutencao errada.
6. UX mobile tem painel inferior pesado, competindo com mapa e resultado.
7. Sugestoes rapidas podem selecionar destino errado em listas com muitos nodes similares.
8. Re-render completo do `main` pode quebrar foco, acessibilidade e interacoes de busca.

