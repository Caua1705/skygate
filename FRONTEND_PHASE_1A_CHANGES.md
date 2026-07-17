# SkyGate Frontend - Fase 1A

Data: 2026-07-17

Status: concluida.

## Escopo

Esta fase estabiliza o contrato com a API publica em http://212.85.0.237:8003. Nenhum arquivo de backend, banco, layout ou index.html foi alterado.

## Arquivos alterados

- api.js
- app.js
- FRONTEND_REFACTOR_PLAN.md
- FRONTEND_PHASE_1A_CHANGES.md

## Contrato confirmado

Fonte: GET http://212.85.0.237:8003/openapi.json.

Schema publico do POST /routes/calculate: RouteRequest.

Payload final:

    {
      "airport_slug": "fortaleza",
      "origin_code": "p1_uber",
      "destination_code": "p2_portao_1",
      "route_mode": "fastest",
      "persist_session": false
    }

airport_slug, origin_code e destination_code sao obrigatorios. route_mode e persist_session sao validos e opcionais. O OpenAPI tambem permite journey_type, boarding_time e preferences, mas eles nao fazem parte do payload desta fase.

Os aliases from_node_code e to_node_code nao sao enviados.

O backend local nao esta presente neste workspace. Nao foi possivel comparar o schema publicado com uma implementacao local; nenhuma divergencia local pode ser confirmada ou descartada.

## Persistencia

api.js aplica uma unica regra:

    persist_session: payload.persist_session ?? false

O uso normal nao envia a propriedade em app.js; o client inclui persist_session: false no request final. O smoke test confirmou o valor no Network.

## Resposta normalizada

O adaptador usa total_estimated_time_minutes primeiro e estimated_time_minutes em seguida. Fallbacks antigos em segundos sao convertidos para minutos.

Exemplo resumido:

    {
      estimatedMinutes: 4.33,
      routeNodeCodes: ["p1_uber", "...", "p2_portao_1"],
      steps: [{ title: "texto original", detail: "", floorId: "", time: "" }],
      floorSegments: [
        { type: "floor", floor: "1", nodes: ["p1_uber", "..."] },
        {
          type: "transition",
          transitionType: "stairs",
          fromFloor: "1",
          toFloor: "2"
        },
        { type: "floor", floor: "2", nodes: ["...", "p2_portao_1"] }
      ],
      servicesOnPath: [],
      warnings: []
    }

O texto original de cada step string e preservado. floor_segments do backend e a fonte de verdade. O agrupamento local por piso so e usado quando os segmentos estiverem ausentes ou nao produzirem nenhum segmento valido.

## Tratamento de erros

- Rede: SkyGateApiError com kind network.
- HTTP 422: kind validation, body real no console e mensagem simples na interface.
- HTTP 404: kind not_found.
- HTTP 500 ou superior: kind server.
- Resposta sem path: mensagem especifica de rota sem caminho.
- Resposta sem steps: warning no console e mensagem no painel; o path continua utilizavel.

Testes diretos confirmaram 422, 404 e falha de rede. Nao foi provocado um HTTP 500 real contra a API publica.

## Testes realizados

### Carregamento e regressao

- GET /airports: aprovado no navegador.
- GET /airports/fortaleza/map: aprovado no navegador.
- Quatro pisos e mapa: aprovados.
- Busca de origem e destino: aprovada.
- Troca dos quatro pisos: aprovada.
- Jornadas embarque, conexao e chegada: aprovadas.
- Horario presente em embarque e conexao e ausente em chegada: aprovado.
- Loading e botao de calcular: aprovados.
- node --check app.js e node --check api.js: aprovados.
- git diff --check: aprovado.

O smoke test encontrou recursao preexistente entre o listener de foco e openSearch(). Uma guarda minima impede novo render quando a busca daquele campo ja esta aberta. Depois da correcao, a busca passou sem excecao.

### Fastest entre pisos

- Origem: p1_uber.
- Destino: p2_portao_1.
- HTTP: 200.
- Backend: 4.33 minutos, 8 nodes e 7 steps.
- Interface: 4 min, 7 steps e dois segmentos de piso.
- Transicao: stairs, piso 1 para piso 2.
- Interface: Use escada.

### Accessible entre pisos

- Origem: p1_uber.
- Destino: p2_portao_1.
- HTTP: 200.
- Backend: 4.46 minutos, 8 nodes e 7 steps.
- Interface: 4 min, 7 steps e dois segmentos de piso.
- Transicao: elevator, piso 1 para piso 2.
- Interface: Use elevador.

### Fastest no mesmo piso

- Origem: p2_portao_1.
- Destino: p2_portao_2.
- HTTP: 200.
- Backend: 0.84 minuto, 3 nodes e 2 steps.
- Interface: 1 min, 2 steps e um segmento de piso.

### Payload observado no navegador

Todos os POST continham airport_slug, origin_code, destination_code, route_mode e persist_session: false.

Nenhum POST continha from_node_code ou to_node_code.

## Console

Erro restante:

    GET http://localhost:5500/favicon.ico 404 (File not found)

Nao houve erro de JavaScript, CORS, API ou renderizacao de rota no smoke test final. O favicon nao foi corrigido porque esta fase proibe alteracoes em index.html.

## Pendencias

- Nao ha backend local neste workspace para comparar versoes.
- HTTP 500 foi tratado no client, mas nao foi provocado deliberadamente.
- O favicon continua ausente.
- Melhorias visuais, arquitetura ampla e Fase 2 nao foram iniciadas.