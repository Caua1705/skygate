# SkyGate Frontend Refactor Plan

Data: 2026-07-17

Objetivo: refatorar o frontend de forma segura, mobile-first e incremental, sem alterar backend, banco ou contratos da API.

Principio: cada fase deve deixar o app funcional ao final.

## Fase 1A: Estabilizacao do Contrato e da Resposta da API

Status: concluida em 2026-07-17.

Escopo concluido:

- Contrato publico confirmado em GET /openapi.json.
- Payload corrigido para origin_code e destination_code.
- persist_session centralizado no api.js, com false como padrao.
- Resposta normalizada em minutos, sem recalcular o caminho.
- Steps em strings preservados sem reescrita.
- Segmentos de piso e transicoes normalizados separadamente.
- services_on_path e warnings preservados.
- Erros de rede, 422, 404, 500 e respostas incompletas diferenciados.
- Smoke test real aprovado no Edge para fastest, accessible, mesmo piso e multiplos pisos.
- Regressoes de jornadas, busca, selecao de piso, loading e mapa verificadas.
- Recursao preexistente no foco da busca corrigida por bloquear o smoke test.

Observacoes:

- O workspace nao contem o backend local; nao foi possivel comparar o OpenAPI publico com um schema local.
- O unico erro restante no console e GET /favicon.ico 404, sem impacto no fluxo. Corrigi-lo exigiria alterar index.html, fora do escopo.
- A Fase 2 nao foi iniciada.
## Fase 1: Arquitetura de Estado e Jornada

### Arquivos envolvidos

- `app.js`
- possivelmente novo `state.js` ou `utils/routeState.js`
- possivelmente novo `utils/apiAdapters.js`

### Mudancas propostas

- Separar estado minimo de UI em um objeto/documento claro:
  - airport
  - map
  - floors
  - selectedFloor
  - journey
  - origin
  - destination
  - routeMode
  - route
  - loading/error
- Separar adaptadores de API:
  - `normalizeAirport`
  - `normalizeMap`
  - `normalizeRoute`
- Corrigir contrato do calculo de rota para usar os campos aceitos pela API publica:
  - `origin_code`
  - `destination_code`
- Manter `persist_session: false`.
- Remover ou isolar fallback que tenta derivar `floor_segments` quando backend ja retorna.
- Criar nomenclatura consistente:
  - jornada `chegada` no frontend pode ser exibida como "Chegada final" ou "Chegada ao destino".

### Riscos

- Quebrar calculo de rota se payload for alterado sem validar com API.
- Perder compatibilidade com algum fallback antigo.
- Introduzir estado mais complexo que o necessario.

### Criterios de aceite

- App carrega `GET /airports`.
- App carrega `GET /airports/fortaleza/map`.
- Calculo de rota funciona com API publica.
- `persist_session: false` confirmado no payload.
- Jornada troca labels sem quebrar origem/destino.
- Nenhuma feature nova criada.

### Dependencias

- Confirmar contrato final do `POST /routes/calculate`.
- Confirmar se o backend deve aceitar aliases antigos ou apenas `origin_code/destination_code`.

## Fase 2: Shell Mobile-First

### Arquivos envolvidos

- `index.html`
- `app.js`
- possivelmente `styles.css` se CSS for extraido

### Mudancas propostas

- Reduzir `index.html` para shell real:
  - header
  - root container
  - scripts
- Remover HTML legado/mockado que e substituido pelo runtime.
- Criar estrutura mobile-first:
  - header compacto
  - mapa como area principal
  - painel inferior de planejamento
  - painel de resultado claro
- Evitar cards dentro de cards.
- Definir alturas e espacamentos consistentes para 390/414/430px.

### Riscos

- Remover HTML legado que ainda contenha estilos/classes usadas por acidente.
- Alterar layout sem validar mobile real.
- Painel inferior cobrir conteudo importante.

### Criterios de aceite

- App abre com shell limpo.
- Mapa visivel na primeira tela mobile.
- CTA principal facil de tocar.
- Desktop continua usavel.
- Nenhum dado mockado aparece antes da API.

### Dependencias

- Fase 1 estabilizada.
- Confirmar se Tailwind CDN continua aceitavel para MVP.

## Fase 3: Origem, Destino e Tres Jornadas

### Arquivos envolvidos

- `app.js`
- possivelmente `journeys.js`
- possivelmente `components/SearchPointInput.js`

### Mudancas propostas

- Consolidar configuracao de jornadas:
  - Embarque
  - Conexao
  - Chegada final / chegada ao destino
- Implementar labels dinamicos:
  - origem
  - destino
  - horario quando aplicavel
- Separar busca em fluxo focado:
  - bottom sheet ou overlay
  - resultados filtrados por nodes reais
  - sugestoes por jornada
- Sugestoes devem abrir lista filtrada, nao escolher sempre o primeiro match quando houver ambiguidade.
- Nunca mostrar `node_code` como informacao principal.

### Riscos

- Sugestoes podem nao encontrar nodes por diferencas de texto/acentuacao.
- Busca pode ficar lenta com 233 nodes se re-renderizar tudo a cada tecla sem cuidado.
- Dropdown dentro de painel fixo pode ficar cortado.

### Criterios de aceite

- Trocar jornada altera labels e campos.
- Embarque mostra horario e scan visual.
- Conexao mostra horario do proximo embarque e alerta de tempo quando ha rota.
- Chegada final nao mostra horario.
- Usuario consegue escolher origem/destino em todas as jornadas.
- Busca funciona por nome amigavel.

### Dependencias

- Lista real de `type` dos nodes para melhorar sugestoes.
- Decidir nomenclatura final: "Chegada final" vs "Chegada ao destino".

## Fase 4: Mapa e Rota por Piso

### Arquivos envolvidos

- `app.js`
- possivelmente `components/MapView.js`
- possivelmente `utils/mapGeometry.js`
- possivelmente `utils/routeAdapters.js`

### Mudancas propostas

- Tratar mapa como componente isolado.
- Desenhar apenas nodes relevantes:
  - origem
  - destino
  - nodes da rota
  - pontos principais do piso
- Reduzir poluicao visual dos 233 nodes.
- Usar `floor_segments` do backend como fonte de verdade.
- Tratar segmentos de transicao:
  - `transition.type`
  - `from_floor`
  - `to_floor`
- Separar seletor de piso:
  - modo exploracao: todos os pisos
  - modo rota: pisos da rota e transicoes

### Riscos

- Simplificar demais e esconder pontos que o usuario espera ver.
- Interpretar incorretamente transicoes sem floor.
- Rota pode nao desenhar se o backend retornar `path` em formato diferente.

### Criterios de aceite

- Mapa mostra piso atual.
- Mapa desenha rota do piso selecionado.
- Em rota multi-piso, mostra apenas segmento do piso atual.
- Troca de piso fica clara.
- Origem, destino e proximo ponto destacados.
- Nao exibe dados tecnicos.

### Dependencias

- Fase 1 deve adaptar corretamente `floor_segments`.
- Confirmar se `path` sempre usa node codes.

## Fase 5: Modo Navegacao

### Arquivos envolvidos

- `app.js`
- possivelmente `components/NavigationPanel.js`
- possivelmente `utils/navigationState.js`

### Mudancas propostas

- Criar estado simples de navegacao:
  - `currentStepIndex`
  - `isNavigating`
  - `isCompleted`
- Exibir um passo por vez.
- Botoes:
  - iniciar
  - anterior
  - proximo
  - concluir
- Sincronizar piso atual com o step/segmento atual.
- Manter lista completa de passos recolhivel.

### Riscos

- Criar complexidade antes da experiencia basica estar estavel.
- Steps sao strings; pode faltar associacao precisa com floor/node.
- Sincronizacao step -> floor pode ser imprecisa.

### Criterios de aceite

- Usuario consegue iniciar navegacao.
- Proximo passo fica destacado.
- Avancar passo nao quebra mapa.
- Concluir exibe estado final simples.
- Sem gravar sessao no backend.

### Dependencias

- Fase 4 concluida.
- Confirmar se backend pode fornecer steps com metadados de floor/node no futuro; se nao, manter aproximacao simples.

## Fase 6: Design System

### Arquivos envolvidos

- `index.html`
- `app.js`
- `assets/design_system.html`
- possivelmente `styles.css`
- possivelmente `components/ui.js`

### Mudancas propostas

- Definir tokens simples:
  - cores
  - espacamento
  - raio
  - sombras
  - tipografia
- Padronizar:
  - botoes
  - chips
  - cards
  - inputs
  - estados
  - badges de piso/tempo
- Remover CSS legado nao utilizado.
- Evitar excesso de gradientes e efeitos.

### Riscos

- Gastar tempo em visual antes de corrigir contrato/fluxo.
- Criar abstracoes demais.
- Alterar demais a identidade visual sem necessidade.

### Criterios de aceite

- UI consistente em mobile e desktop.
- Botoes principais com area minima de toque.
- Cards e painels com hierarquia clara.
- Estado visual nao depende apenas de cor.
- HTML/CSS legado reduzido.

### Dependencias

- Shell mobile-first definido.
- Componentes principais estabilizados.

## Fase 7: Acessibilidade e Responsividade

### Arquivos envolvidos

- `index.html`
- `app.js`
- possivelmente `styles.css`

### Mudancas propostas

- Adicionar labels reais e ids para inputs.
- Melhorar busca para padrao combobox/listbox ou bottom sheet acessivel.
- Garantir foco previsivel apos render.
- Adicionar `aria-live` para loading/erro/resultado.
- Testar 390px, 414px, 430px.
- Testar desktop.
- Verificar contraste.
- Garantir que texto nao estoure botoes/cards.

### Riscos

- Re-render completo dificulta preservar foco.
- Sem framework, acessibilidade de combobox pode ficar trabalhosa.
- Ajustes responsivos podem conflitar com painel fixo.

### Criterios de aceite

- Navegacao por teclado basica funciona.
- Leitores de tela recebem estados principais.
- Mobile 390/414/430px sem sobreposicao incoerente.
- Desktop nao quebra.
- Controles principais tem pelo menos 44px de altura.

### Dependencias

- Layout final da Fase 2/3.
- Decisao sobre busca: dropdown vs bottom sheet.

## Fase 8: Testes e Producao

### Arquivos envolvidos

- `app.js`
- `api.js`
- `index.html`
- possivelmente scripts de teste se forem adicionados futuramente

### Mudancas propostas

- Criar checklist manual de smoke test:
  - carregar aeroportos
  - carregar mapa
  - trocar piso
  - trocar jornada
  - escolher origem
  - escolher destino
  - calcular fastest
  - calcular accessible
  - rota multi-piso
  - erro de API
- Validar API publica:
  - `http://212.85.0.237:8003`
- Validar CORS no navegador.
- Confirmar que `persist_session=false` esta no payload.
- Preparar troca futura de IP para dominio via `API_BASE_URL`.

### Riscos

- Testes manuais podem deixar regressao passar.
- API publica por IP/HTTP pode ter restricoes futuras de HTTPS/mixed content quando frontend for hospedado em HTTPS.
- CORS pode mudar no backend.

### Criterios de aceite

- Smoke test completo passa.
- Fastest calcula.
- Accessible calcula.
- Rota renderiza tempo, steps e floor_segments.
- Nao ha dados tecnicos na interface principal.
- Sem erros de console relevantes.

### Dependencias

- Backend publico disponivel.
- CORS ajustado no backend.
- URL final ou estrategia para trocar IP por dominio.

## Primeira Alteracao Recomendada

Corrigir o contrato de `POST /routes/calculate` no frontend:

- trocar `from_node_code` por `origin_code`
- trocar `to_node_code` por `destination_code`
- manter `airport_slug`
- manter `route_mode`
- manter `persist_session: false`

Motivo: a API publica validada retorna 422 com o payload atual. Antes de qualquer refatoracao visual, o fluxo basico precisa calcular rota de forma confiavel.

## Ordem Recomendada

1. Corrigir contrato de rota e normalizacao dos campos reais de resposta.
2. Reduzir `index.html` para shell limpo.
3. Separar adaptadores/estado de `app.js`.
4. Reorganizar layout mobile-first.
5. Refinar busca e jornadas.
6. Refinar mapa por piso.
7. Introduzir modo navegacao simples.
8. Fazer polimento visual, acessibilidade e checklist de producao.

