/**
 * SkyGate — Node Presentation Layer  (nodePresentation.js)
 *
 * The single source of truth for every string the passenger sees.
 * Raw node codes, backend names and corridor labels never leave this module.
 *
 * Public exports:
 *   INTERNAL_TYPES, VERTICAL_TYPES, CIRCULATION_TYPES, POI_TYPES
 *   SEARCH_CATEGORIES
 *   getTypeMeta(type)
 *   getPublicNodeLabel(node, context?)
 *   getPublicNodeSubtitle(node)
 *   getPublicNodeCategory(node)
 *   getNodeSearchAliases(node)
 *   isNodeVisibleInDefaultSearch(node)
 *   isNodeVisibleInTextSearch(node, normalizedQuery)
 *   isNodeVisibleOnMap(node, routeNodeCodesSet?)
 *   getRouteLandmarkLabel(node, ctx?)
 *   buildSearchText(node)
 *   runPresentationTests()
 */

/* ── FLOOR LABELS ─────────────────────────────────────────── */
const _FL = { '0': 'Térreo', '1': 'Piso 1', '2': 'Piso 2', '3': 'Piso 3' };
export function getFloorLabel(id) { return _FL[String(id ?? '')] ?? `Piso ${id}`; }

/* ── TYPE SETS ────────────────────────────────────────────── */
export const INTERNAL_TYPES = new Set([
  'corridor', 'waypoint', 'transition', 'junction',
  'intersection', 'connection', 'bridge', 'link',
]);
export const VERTICAL_TYPES    = new Set(['elevator', 'stairs', 'escalator']);
export const CIRCULATION_TYPES = new Set(['elevator', 'stairs', 'escalator']);

const _DEFAULT_SEARCH_TYPES = new Set([
  'gate','entrance','exit','checkin','restroom','restaurant','shop',
  'lounge','pharmacy','atm','currency_exchange','medical',
  'car_rental','transport_service','service','service_area',
]);
export const POI_TYPES = new Set([..._DEFAULT_SEARCH_TYPES, 'elevator','stairs','escalator']);

/* ── SEARCH CATEGORIES ────────────────────────────────────── */
export const SEARCH_CATEGORIES = [
  { key:'gates',       label:'Portões',                      icon:'solar:routing-2-bold',      types:['gate'] },
  { key:'food',        label:'Alimentação',                  icon:'solar:cup-hot-bold',         types:['restaurant'] },
  { key:'shops',       label:'Lojas',                        icon:'solar:bag-4-bold',           types:['shop','pharmacy'] },
  { key:'restrooms',   label:'Banheiros',                    icon:'solar:bath-bold',            types:['restroom'] },
  { key:'services',    label:'Serviços',                     icon:'solar:info-circle-bold',     types:['service','service_area','atm','currency_exchange','medical','lounge','car_rental','transport_service','checkin'] },
  { key:'access',      label:'Entradas e saídas',            icon:'solar:door-bold',            types:['entrance','exit'] },
  { key:'circulation', label:'Acessibilidade e circulação',  icon:'solar:elevator-bold',        types:['elevator','stairs','escalator'] },
];

/* ── TYPE META ────────────────────────────────────────────── */
const _TYPE_META = {
  gate:              { publicType:'Portão',               icon:'solar:routing-2-bold',           color:'#1e3a5f' },
  entrance:          { publicType:'Entrada',              icon:'solar:door-bold',                color:'#1e3a5f' },
  exit:              { publicType:'Saída',                icon:'solar:exit-bold',                color:'#1e3a5f' },
  checkin:           { publicType:'Check-in',             icon:'solar:case-round-bold',          color:'#1e3a5f' },
  restroom:          { publicType:'Banheiro',             icon:'solar:bath-bold',                color:'#475569' },
  restaurant:        { publicType:'Alimentação',          icon:'solar:cup-hot-bold',             color:'#0d9488' },
  shop:              { publicType:'Loja',                 icon:'solar:bag-4-bold',               color:'#0d9488' },
  lounge:            { publicType:'Sala VIP',             icon:'solar:sofa-bold',                color:'#7c3aed' },
  pharmacy:          { publicType:'Farmácia',             icon:'solar:pills-3-bold',             color:'#16a34a' },
  atm:               { publicType:'Caixa Eletrônico',     icon:'solar:card-bold',                color:'#475569' },
  currency_exchange: { publicType:'Câmbio',               icon:'solar:dollar-minimalistic-bold', color:'#475569' },
  medical:           { publicType:'Atendimento Médico',   icon:'solar:medical-kit-bold',         color:'#dc2626' },
  car_rental:        { publicType:'Aluguel de Carros',    icon:'solar:wheel-bold',               color:'#475569' },
  transport_service: { publicType:'Transporte',           icon:'solar:bus-bold',                 color:'#475569' },
  service:           { publicType:'Serviço',              icon:'solar:info-circle-bold',         color:'#475569' },
  service_area:      { publicType:'Área de Serviços',     icon:'solar:info-circle-bold',         color:'#475569' },
  elevator:          { publicType:'Elevador',             icon:'solar:elevator-bold',            color:'#d97706' },
  stairs:            { publicType:'Escada',               icon:'solar:stairs-bold',              color:'#d97706' },
  escalator:         { publicType:'Escada Rolante',       icon:'solar:sort-vertical-bold',       color:'#d97706' },
  corridor:          { publicType:'Corredor',             icon:'solar:arrow-right-bold',         color:'#94a3b8' },
  waypoint:          { publicType:'Passagem',             icon:'solar:arrow-right-bold',         color:'#94a3b8' },
};
export function getTypeMeta(type) {
  return _TYPE_META[String(type||'').toLowerCase()]
    ?? { publicType:'Local', icon:'solar:map-point-bold', color:'#94a3b8' };
}

/* ── PRESENTATION OVERRIDES (keyed by stable node code) ────── */
const _OV = {
  /* Térreo */
  p0_elevador_a:                   { n:'Elevador do Térreo',                              s:'Térreo · Acessibilidade',              a:['elevador','acessibilidade'] },
  p0_elevador_acesso_externo_a:    { n:'Elevador do acesso externo A',                   s:'Térreo · Acesso externo',              a:['elevador','acesso externo','acessibilidade'] },
  p0_elevador_acesso_externo_b:    { n:'Elevador do acesso externo B',                   s:'Térreo · Acesso externo',              a:['elevador','acesso externo','acessibilidade'] },
  p0_escada_a:                     { n:'Escada do Térreo — área central',                s:'Térreo',                               a:['escada'] },
  p0_escada_b:                     { n:'Escada do Térreo — lado oeste',                  s:'Térreo',                               a:['escada'] },
  p0_escada_acesso_externo:        { n:'Escada do acesso externo',                       s:'Térreo · Acesso externo',              a:['escada','acesso externo'] },
  p0_escada_rolante_a:             { n:'Escada rolante do Térreo A',                     s:'Térreo',                               a:['escada rolante','rolante'] },
  p0_escada_rolante_acesso_externo_a:{ n:'Escada rolante do acesso externo A',           s:'Térreo · Acesso externo',              a:['escada rolante','rolante','acesso externo'] },
  p0_escada_rolante_acesso_externo_b:{ n:'Escada rolante do acesso externo B',           s:'Térreo · Acesso externo',              a:['escada rolante','rolante','acesso externo'] },
  p0_wc_leste:                     { n:'Banheiro — lado leste',                          s:'Térreo · Banheiros',                   a:['banheiro','sanitario','wc','toalete'] },
  p0_wc_oeste:                     { n:'Banheiro — lado oeste',                          s:'Térreo · Banheiros',                   a:['banheiro','sanitario','wc','toalete'] },
  p0_porta_1:                      { n:'Porta 1 — Entrada e saída',                      s:'Térreo · Acesso principal',            a:['porta 1','entrada','saida'] },
  p0_porta_2:                      { n:'Porta 2 — Entrada e saída',                      s:'Térreo · Acesso principal',            a:['porta 2','entrada','saida'] },
  /* Piso 1 */
  p1_elevador_b:                   { n:'Elevador do desembarque internacional',          s:'Piso 1 · Desembarque internacional',  a:['elevador','desembarque','internacional','acessibilidade'] },
  p1_elevador_c:                   { n:'Elevador próximo à aduana',                      s:'Piso 1 · Aduana',                     a:['elevador','aduana','acessibilidade'] },
  p1_elevador_acesso_externo:      { n:'Elevador do acesso externo',                     s:'Piso 1 · Acesso externo',              a:['elevador','acesso externo','acessibilidade'] },
  p1_escada_acesso_externo:        { n:'Escada do acesso externo',                       s:'Piso 1 · Acesso externo',              a:['escada','acesso externo'] },
  p1_escada_e:                     { n:'Escada do desembarque doméstico',                s:'Piso 1 · Desembarque doméstico',      a:['escada','desembarque','domestico'] },
  p1_escada_f:                     { n:'Escada do desembarque — lado central',           s:'Piso 1',                              a:['escada','desembarque'] },
  p1_escada_g:                     { n:'Escada do desembarque — lado leste',             s:'Piso 1 · Desembarque',                a:['escada','desembarque'] },
  p1_wc:                           { n:'Banheiro do desembarque internacional',          s:'Piso 1 · Desembarque internacional',  a:['banheiro','sanitario','wc','toalete','desembarque'] },
  /* Piso 2 */
  p2_elevador_a:                   { n:'Elevador da área central',                       s:'Piso 2 · Área central',               a:['elevador','area central','acessibilidade'] },
  p2_elevador_b:                   { n:'Elevador do embarque doméstico',                 s:'Piso 2 · Embarque doméstico',         a:['elevador','embarque','domestico','acessibilidade'] },
  p2_elevador_c:                   { n:'Elevador próximo ao Portão 5',                   s:'Piso 2 · Embarque doméstico',         a:['elevador','portao 5','porta 5','portao5','acessibilidade','embarque'] },
  p2_elevador_d:                   { n:'Elevador do embarque internacional',             s:'Piso 2 · Embarque internacional',     a:['elevador','embarque','internacional','acessibilidade'] },
  p2_elevador_e:                   { n:'Elevador do pier leste',                         s:'Piso 2 · Pier',                       a:['elevador','pier','acessibilidade'] },
  p2_elevador_f:                   { n:'Elevador do pier oeste',                         s:'Piso 2 · Pier',                       a:['elevador','pier','acessibilidade'] },
  p2_elevador_acesso_externo_a:    { n:'Elevador do acesso externo A',                   s:'Piso 2 · Acesso externo',              a:['elevador','acesso externo','acessibilidade'] },
  p2_elevador_acesso_externo_b:    { n:'Elevador do acesso externo B',                   s:'Piso 2 · Acesso externo',              a:['elevador','acesso externo','acessibilidade'] },
  p2_escada_a:                     { n:'Escada da área central A',                       s:'Piso 2 · Área central',               a:['escada'] },
  p2_escada_b:                     { n:'Escada da área central B',                       s:'Piso 2 · Área central',               a:['escada'] },
  p2_escada_c:                     { n:'Escada próxima ao Portão 5',                     s:'Piso 2 · Embarque doméstico',         a:['escada','portao 5','porta 5','portao5'] },
  p2_escada_d:                     { n:'Escada do embarque doméstico leste',             s:'Piso 2 · Embarque doméstico',         a:['escada','embarque','domestico'] },
  p2_escada_e:                     { n:'Escada do embarque doméstico — centro',          s:'Piso 2 · Embarque doméstico',         a:['escada','embarque','domestico'] },
  p2_escada_f:                     { n:'Escada do embarque internacional',               s:'Piso 2 · Embarque internacional',     a:['escada','embarque','internacional'] },
  p2_escada_h:                     { n:'Escada do pier leste',                           s:'Piso 2 · Pier',                       a:['escada','pier'] },
  p2_escada_i:                     { n:'Escada do pier — área central',                  s:'Piso 2 · Pier',                       a:['escada','pier'] },
  p2_escada_j:                     { n:'Escada do pier oeste',                           s:'Piso 2 · Pier',                       a:['escada','pier'] },
  p2_escada_acesso_externo:        { n:'Escada do acesso externo',                       s:'Piso 2 · Acesso externo',              a:['escada','acesso externo'] },
  p2_escada_rolante_a:             { n:'Escada rolante da área central A',               s:'Piso 2 · Área central',               a:['escada rolante','rolante'] },
  p2_escada_rolante_b:             { n:'Escada rolante da área central B',               s:'Piso 2 · Área central',               a:['escada rolante','rolante'] },
  p2_escada_rolante_c:             { n:'Escada rolante do embarque doméstico',           s:'Piso 2 · Embarque doméstico',         a:['escada rolante','rolante','embarque'] },
  p2_escada_rolante_d:             { n:'Escada rolante do embarque internacional',       s:'Piso 2 · Embarque internacional',     a:['escada rolante','rolante','embarque','internacional'] },
  p2_wc_sala_embarque_domestico:   { n:'Banheiro da sala de embarque doméstico',         s:'Piso 2 · Embarque doméstico',         a:['banheiro','sanitario','wc','toalete','embarque','domestico'] },
  p2_wc_raio_x:                    { n:'Banheiro próximo ao raio-X',                     s:'Piso 2 · Controle de segurança',      a:['banheiro','sanitario','wc','toalete','raio x','seguranca'] },
  p2_wc_embarque_internacional:    { n:'Banheiro do embarque internacional',             s:'Piso 2 · Embarque internacional',     a:['banheiro','sanitario','wc','toalete','embarque','internacional'] },
  p2_wc_pier_oeste:                { n:'Banheiro do pier oeste',                         s:'Piso 2 · Pier',                       a:['banheiro','sanitario','wc','toalete','pier'] },
  p2_wc_embarque_domestico:        { n:'Banheiro do embarque doméstico',                 s:'Piso 2 · Embarque doméstico',         a:['banheiro','sanitario','wc','toalete','embarque','domestico'] },
  p2_wc_controle_passaporte:       { n:'Banheiro próximo ao controle de passaporte',     s:'Piso 2 · Embarque internacional',     a:['banheiro','sanitario','wc','toalete','passaporte','controle'] },
  p2_wc_sala_embarque_domestico_leste:{ n:'Banheiro — sala de embarque doméstico leste', s:'Piso 2 · Embarque doméstico',        a:['banheiro','sanitario','wc','toalete','embarque','domestico'] },
  p2_wc_pier_leste:                { n:'Banheiro do pier leste',                         s:'Piso 2 · Pier',                       a:['banheiro','sanitario','wc','toalete','pier'] },
  /* Piso 3 */
  p3_elevador_b:                   { n:'Elevador do Piso 3',                              s:'Piso 3 · Acessibilidade',              a:['elevador','piso 3','acessibilidade'] },
  p3_elevador_c:                   { n:'Elevador do Piso 3 — acesso B',                  s:'Piso 3 · Acessibilidade',              a:['elevador','piso 3','acessibilidade'] },
  p3_escada_c:                     { n:'Escada do Piso 3',                                s:'Piso 3',                              a:['escada','piso 3'] },
  p3_wc:                           { n:'Banheiro do Piso 3',                              s:'Piso 3 · Banheiros',                  a:['banheiro','sanitario','wc','toalete','piso 3'] },
};

/* Universal aliases by type */
const _TYPE_ALIASES = {
  restroom:   ['banheiro','sanitario','wc','toalete','lavabo','lavatorio'],
  elevator:   ['elevador','acessibilidade'],
  stairs:     ['escada','escadas','subir','descer'],
  escalator:  ['escada rolante','rolante','esteira'],
  gate:       ['portao','embarque','gate'],
  entrance:   ['entrada','porta','acesso'],
  exit:       ['saida','porta','acesso'],
  restaurant: ['alimentacao','comida','cafe','lanche','restaurante'],
  shop:       ['loja','compras','souvenir'],
  checkin:    ['check-in','checkin','despacho'],
};

/* Corridor safe labels */
const _CORR = {
  p0_corredor_acesso_terminal:'Passagem de acesso ao terminal',
  p0_corredor_centro:'Corredor central do Térreo',
  p0_corredor_leste:'Corredor leste do Térreo',
  p0_corredor_oeste:'Corredor oeste do Térreo',
  p2_corredor_embarque_domestico_centro:'Corredor do embarque doméstico — centro',
  p2_corredor_controle_passaporte:'Corredor do controle de passaporte',
  p2_corredor_central:'Corredor central do Piso 2',
  p2_corredor_embarque_internacional:'Corredor do embarque internacional',
  p2_corredor_portoes_23_28:'Corredor dos portões 23 a 28',
  p2_corredor_embarque_domestico_leste:'Corredor do embarque doméstico — leste',
  p2_corredor_embarque_domestico_oeste:'Corredor do embarque doméstico — oeste',
  p3_corredor_central:'Corredor do Piso 3',
};

/* ── PRIVATE HELPERS ──────────────────────────────────────── */
function _n(v){ return String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }

function _ambiguous(raw,prefix){
  return /^(elevador|escada rolante|escada)\s+[a-z\d]$/i.test(_n(raw));
}

function _clean(raw){
  return String(raw??'')
    .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}\b/g,'')
    .replace(/\s{2,}/g,' ').trim();
}

/* ── PUBLIC FUNCTIONS ─────────────────────────────────────── */

export function getPublicNodeLabel(node, _ctx='default'){
  if(!node) return 'Local do aeroporto';
  const ov=_OV[node.code];
  if(ov?.n) return ov.n;
  if(INTERNAL_TYPES.has(node.type)) return _CORR[node.code]??'Área do aeroporto';
  const raw=node.name??'';
  if(node.type==='restroom'){
    const c=raw.replace(/^(Sanitário|Banheiro|WC|Sanitario|Sanitários)\s*/i,'').trim();
    return c?`Banheiro ${_clean(c)}`:'Banheiro do aeroporto';
  }
  if(node.type==='elevator'){ return _ambiguous(raw)? `Elevador do ${getFloorLabel(node.floorId)}`:_clean(raw); }
  if(node.type==='stairs'){   return _ambiguous(raw)? `Escada do ${getFloorLabel(node.floorId)}`:_clean(raw); }
  if(node.type==='escalator'){ return _ambiguous(raw)?`Escada rolante do ${getFloorLabel(node.floorId)}`:_clean(raw); }
  return _clean(raw)||getTypeMeta(node.type).publicType;
}

export function getPublicNodeSubtitle(node){
  if(!node) return '';
  const ov=_OV[node.code];
  if(ov?.s) return ov.s;
  const f=getFloorLabel(node.floorId);
  if(CIRCULATION_TYPES.has(node.type)) return `${f} · Acessibilidade e circulação`;
  if(node.type==='restroom') return `${f} · Banheiros`;
  return f;
}

export function getPublicNodeCategory(node){
  if(!node) return 'Serviço';
  if(CIRCULATION_TYPES.has(node.type)) return 'Acessibilidade e circulação';
  return getTypeMeta(node.type).publicType;
}

export function getNodeSearchAliases(node){
  if(!node) return [];
  const base=[
    _n(getPublicNodeLabel(node)),
    _n(getTypeMeta(node.type).publicType),
    _n(getFloorLabel(node.floorId)),
  ];
  const ov=_OV[node.code];
  (ov?.a??[]).forEach(a=>base.push(_n(a)));
  (_TYPE_ALIASES[node.type]??[]).forEach(a=>base.push(a));
  return [...new Set(base.filter(Boolean))];
}

export function isNodeVisibleInDefaultSearch(node){
  if(!node) return false;
  if(INTERNAL_TYPES.has(node.type)) return false;
  if(CIRCULATION_TYPES.has(node.type)) return false;
  return _DEFAULT_SEARCH_TYPES.has(node.type);
}

export function isNodeVisibleInTextSearch(node, nq){
  if(!node) return false;
  if(INTERNAL_TYPES.has(node.type)) return false;
  if(!nq) return isNodeVisibleInDefaultSearch(node);
  return getNodeSearchAliases(node).some(a=>a.includes(nq));
}

export function isNodeVisibleOnMap(node, routeSet=null){
  if(!node) return false;
  if(INTERNAL_TYPES.has(node.type)) return false;
  if(routeSet) return routeSet.has(node.code);
  return _DEFAULT_SEARCH_TYPES.has(node.type);
}

export function getRouteLandmarkLabel(node, ctx={}){
  if(!node) return '';
  const label=getPublicNodeLabel(node);
  const toF=ctx.toFloor?getFloorLabel(ctx.toFloor):'';
  if(node.type==='elevator')  return toF?`Use ${label} para subir ao ${toF}.`:`Use ${label}.`;
  if(node.type==='stairs')    return toF?`Suba pela ${label} até o ${toF}.`:`Use a ${label}.`;
  if(node.type==='escalator') return toF?`Use a ${label} até o ${toF}.`:`Use a ${label}.`;
  if(node.type==='entrance')  return `Entre pelo ${label}.`;
  if(node.type==='exit')      return `Saia pelo ${label}.`;
  if(node.type==='gate')      return `Dirija-se ao ${label}.`;
  if(ctx.isDest)              return `Chegue a ${label}.`;
  return `Passe por ${label}.`;
}

export function buildSearchText(node){
  return getNodeSearchAliases(node).join(' ');
}

/* ── TESTS ────────────────────────────────────────────────── */
export function runPresentationTests(){
  const pass=[],fail=[];
  function ok(d,v){ if(v) pass.push(d); else fail.push(`FAIL: ${d}`); }
  function eq(d,g,e){ if(g===e) pass.push(d); else fail.push(`FAIL: ${d}\n  got:"${g}" expected:"${e}"`); }
  function notContains(d,s,f){ if(!String(s).includes(f)) pass.push(d); else fail.push(`FAIL: ${d} — "${s}" contains "${f}"`); }
  const mk=(code,type,name,fl='2')=>({code,type,name,floorId:fl,isPoi:POI_TYPES.has(type),isInternal:INTERNAL_TYPES.has(type),isVertical:VERTICAL_TYPES.has(type)});

  ok('corridor hidden default',       !isNodeVisibleInDefaultSearch(mk('p2_corredor_central','corridor','Corredor Central')));
  ok('waypoint hidden default',       !isNodeVisibleInDefaultSearch(mk('p1_transicao_passarela','waypoint','Transição Passarela')));
  ok('elevator hidden default',       !isNodeVisibleInDefaultSearch(mk('p2_elevador_b','elevator','Elevador B')));
  ok('gate visible default',           isNodeVisibleInDefaultSearch(mk('p2_portao_5','gate','Portão 5')));
  ok('restaurant visible default',     isNodeVisibleInDefaultSearch(mk('p1_beach_park','restaurant','Beach Park','1')));
  eq('p2_elevador_b override',         getPublicNodeLabel(mk('p2_elevador_b','elevator','Elevador B')), 'Elevador do embarque doméstico');
  eq('p2_elevador_c override',         getPublicNodeLabel(mk('p2_elevador_c','elevator','Elevador C')), 'Elevador próximo ao Portão 5');
  eq('p2_escada_c override',           getPublicNodeLabel(mk('p2_escada_c','stairs','Escada C')),       'Escada próxima ao Portão 5');
  notContains('Elevador Z hidden',     getPublicNodeLabel(mk('px_elev_z','elevator','Elevador Z')),     'Elevador Z');
  ok('restroom uses Banheiro',         getPublicNodeLabel(mk('p2_wc_raio_x','restroom','Sanitário Raio-X')).startsWith('Banheiro'));
  notContains('restroom no Sanitário', getPublicNodeLabel(mk('p2_wc_raio_x','restroom','Sanitário Raio-X')), 'Sanitário');
  ok('"banheiro" finds WC node',       isNodeVisibleInTextSearch(mk('p2_wc_embarque_domestico','restroom','Sanitário Embarque Doméstico'), 'banheiro'));
  ok('"elevador" finds elevator',      isNodeVisibleInTextSearch(mk('p2_elevador_b','elevator','Elevador B'), 'elevador'));
  ok('corridor not in text search',   !isNodeVisibleInTextSearch(mk('p2_corredor_central','corridor','Corredor Central'), 'corredor'));
  notContains('node code not in label', getPublicNodeLabel(mk('p2_portao_5','gate','Portão 5')), 'p2_portao_5');
  notContains('Corredor A never shown', getPublicNodeLabel(mk('p2_corredor_x','corridor','Corredor A')), 'Corredor A');
  notContains('Transição never shown',  getPublicNodeLabel(mk('p1_transicao_passarela','waypoint','Transição Passarela')), 'Transição Passarela');
  ok('subtitle includes floor',        getPublicNodeSubtitle(mk('p2_wc_raio_x','restroom','Sanitário Raio-X')).includes('Piso 2'));
  ok('"wc" alias finds restroom',      isNodeVisibleInTextSearch(mk('p0_wc_leste','restroom','Sanitários Leste','0'), 'wc'));
  ok('"porta 5" finds elev near portao 5', isNodeVisibleInTextSearch(mk('p2_elevador_c','elevator','Elevador C'), _n('porta 5')));

  const total=pass.length+fail.length;
  console.group(`[SkyGate Presentation Tests] ${pass.length}/${total} passed`);
  fail.forEach(f=>console.error(f));
  if(!fail.length) console.log('All tests passed');
  console.groupEnd();
  return {pass:pass.length,fail:fail.length,failures:fail};
}
if(typeof window!=='undefined') window.__sgPresentationTests=runPresentationTests;
