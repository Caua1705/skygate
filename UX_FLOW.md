# SkyGate UX Flow

Data: 2026-07-17

Objetivo: documentar o fluxo atual e preparar uma evolucao mobile-first para tres jornadas sem criar features novas.

## 1. Modelo Mental do Produto

SkyGate deve ajudar uma pessoa dentro do aeroporto a responder rapidamente:

1. Onde estou?
2. Para onde vou?
3. Qual caminho seguir?
4. Quanto tempo leva?
5. Qual e o proximo passo?
6. Em qual piso estou?

O app nao deve parecer um painel tecnico de mapa. Deve parecer um assistente de navegacao aeroportuaria.

## 2. Jornadas

### Embarque

Intencao do usuario:

- Entrou no aeroporto ou esta em alguma area publica.
- Precisa chegar ao portao ou a uma etapa antes do portao.
- Pode querer saber se ainda da tempo.

Campos esperados:

- Origem: "Onde voce esta agora?"
- Destino: "Qual seu portao ou destino?"
- Horario: "Horario de embarque" opcional.
- Atalho visual: "Escanear passagem" apenas como futuro recurso, sem OCR real.

Resultado deve destacar:

- Tempo estimado ate destino.
- Proximo passo.
- Se horario foi informado, folga ou alerta de aperto.
- Piso atual e troca de piso.

### Conexao

Intencao do usuario:

- Acabou de desembarcar.
- Precisa chegar ao proximo portao.
- Tempo e mais critico.

Campos esperados:

- Origem: "Onde voce chegou?"
- Destino: "Qual seu proximo portao?"
- Horario: "Horario do proximo embarque" ou tempo ate embarque.

Resultado deve destacar:

- Tempo estimado.
- Alerta de tempo apertado quando aplicavel.
- Proximo passo.
- Troca de piso e tipo de transicao.

### Chegada final

Intencao do usuario:

- Desembarcou e vai sair ou buscar servicos.
- Nao ha horario de embarque.

Campos esperados:

- Origem: "Onde voce desembarcou?"
- Destino: "Para onde voce quer ir agora?"
- Sem horario de embarque.

Sugestoes esperadas:

- Bagagem
- Saida
- Uber/App
- Taxi
- Banheiro
- Alimentacao

Resultado deve destacar:

- Tempo estimado ate destino.
- Proximo passo.
- Piso atual e troca de piso, se houver.

## 3. Fluxo Atual do Frontend

### Ao abrir

1. Renderiza loading de aeroportos.
2. Chama `GET /airports`.
3. Seleciona Fortaleza por slug.
4. Renderiza loading de mapa.
5. Chama `GET /airports/fortaleza/map`.
6. Normaliza nodes e pisos.
7. Mostra mapa e painel de planejamento.

### Planejamento

1. Usuario escolhe jornada.
2. Usuario escolhe origem via busca ou sugestao.
3. Usuario escolhe destino via busca ou sugestao.
4. Usuario escolhe modo:
   - Mais rapida
   - Acessivel
5. Usuario clica calcular.

### Calculo

1. Frontend chama `POST /routes/calculate`.
2. Deve enviar `persist_session: false`.
3. Recebe rota.
4. Normaliza rota.
5. Seleciona o primeiro piso da rota.
6. Renderiza resumo, proximo passo, segmentos por piso e steps.

### Mapa

1. Mostra nodes do piso selecionado.
2. Desenha polyline com nodes da rota no piso.
3. Destaca origem, destino e proximo node.
4. Permite trocar piso.
5. Permite trocar trecho de rota por piso quando ha multiplos pisos.

## 4. Problemas do Fluxo Atual

### Fluxo visual muito pesado no mobile

O painel inferior contem muitos controles ao mesmo tempo:

- jornada
- origem
- destino
- horario
- scan
- modo
- CTA

Em 390-430px isso compete diretamente com o mapa.

### Busca e sugestoes competem

Sugestoes rapidas aparecem sob cada campo. Em jornadas com muitas sugestoes, a area vertical aumenta. O usuario pode tocar uma sugestao que escolhe automaticamente o primeiro match, mesmo quando ha varios pontos parecidos.

### Resultado nao vira modo de navegacao

O resultado mostra passos, mas nao ha estado "estou navegando". O proximo passo e destacado, mas nao ha avancar/progresso/concluido.

### Pisos e segmentos se misturam

O usuario ve:

- seletor de piso do aeroporto
- seletor de trecho por piso da rota
- label de piso atual no resumo

Isso e correto tecnicamente, mas pode parecer redundante.

### Hierarquia precisa ser mais clara

O app deve priorizar:

1. Mapa/piso atual
2. Proximo passo quando houver rota
3. CTA ou acao principal
4. Campos de edicao

Hoje o planejamento ainda domina a tela.

## 5. Fluxo Mobile-First Recomendado

### Estado inicial

Topo compacto:

- Aeroporto
- Jornada atual
- Status de API/loading/erro

Area principal:

- Mapa do piso selecionado.
- Controle de piso compacto.

Painel inferior:

- Origem
- Destino
- Modo
- CTA

### Ao selecionar origem/destino

Usar um bottom sheet ou overlay focado:

- Campo de busca no topo.
- Sugestoes por jornada.
- Resultados por nome amigavel.
- Piso como informacao secundaria.
- Sem mostrar `node_code`.

### Apos calcular rota

Area principal:

- Mapa com rota do piso atual.
- Origem/destino/proximo ponto destacados.

Painel de rota:

- Tempo estimado.
- Proximo passo grande.
- Botao para expandir todos os passos.
- Segmentos por piso.

### Troca de piso

Quando rota tiver transicao:

- Mostrar um card separado:
  - "Trocar para piso X"
  - "Use elevador/escada/escada rolante"
- O seletor de piso deve destacar apenas pisos da rota no modo rota.

### Modo navegacao futuro

Sem criar feature nova agora, preparar o fluxo para:

- iniciar navegacao
- passo atual
- proximo
- anterior
- concluir

Mas nao implementar ate a fase planejada.

## 6. Estados UX Necessarios

### Loading aeroportos

Mensagem:

- "Carregando aeroportos..."
- Deve bloquear campos.

### Loading mapa

Mensagem:

- "Carregando mapa..."
- Deve mostrar skeleton simples do mapa.

### Empty mapa

Mensagem:

- "Nao encontramos pontos neste aeroporto."
- CTA secundario: tentar novamente.

### Selecionar origem/destino

Mensagem:

- "Selecione origem e destino para calcular."
- Botao desabilitado deve ter explicacao.

### Calculando rota

Mensagem:

- "Calculando melhor rota..."
- CTA em loading.

### Rota nao encontrada

Mensagem:

- "Nao encontramos rota entre esses pontos."
- Sugerir trocar origem, destino ou modo.

### Rota calculada

Mostrar:

- tempo estimado
- modo
- proximo passo
- pisos da rota
- steps recolhidos ou listados de forma limpa

### Erro API/CORS

Mensagem:

- "Nao foi possivel acessar a API."
- Detalhe tecnico apenas em dev/log.

## 7. Regras de Conteudo

### Nao mostrar como informacao principal

- `node_code`
- `edge_type`
- `weight_seconds`
- ids UUID
- nomes internos de edges

### Mostrar para usuario

- nome amigavel do ponto
- piso
- tempo estimado em minutos
- proximo passo em linguagem natural
- tipo de transicao entre pisos

## 8. Criterios de Boa Experiencia

Mobile 390-430px:

- CTA sempre facil de tocar.
- Inputs com altura minima de 44px.
- Mapa visivel sem rolar imediatamente.
- Busca nao deve ficar cortada pelo viewport.
- Resultado deve destacar um unico proximo passo.

Desktop:

- Nao deve quebrar.
- Painel lateral pode existir.
- Mapa deve continuar sendo area principal.

Acessibilidade:

- Labels reais para inputs.
- Sem dependencia exclusiva de cor.
- Foco previsivel.
- Estados com texto claro.
- Controles com nomes acessiveis.

