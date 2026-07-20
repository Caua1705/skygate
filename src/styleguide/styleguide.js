/**
 * Styleguide — renders every DS token and component on one page.
 * Entry point for styleguide.html. Not imported by the app.
 */
import {
  Button, IconButton, Card, Chip, Metric, MetricGroup,
  Header, Sheet, StepRail, dsIcon,
} from '../components/ds/index.js';

/* ---------- contrast maths, so the page proves its own claims ---------- */
const hexToRgb = h => { h = h.replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = h => { const [r, g, b] = hexToRgb(h); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1]; return (hi + 0.05) / (lo + 0.05); };

const section = (title, note, html) => `
  <section class="sgd-section">
    <h2 class="sgd-h2">${title}</h2>
    ${note ? `<p class="sgd-note">${note}</p>` : ''}
    <div class="sgd-block">${html}</div>
  </section>`;

const row = html => `<div class="sgd-row">${html}</div>`;

/* ---------- tokens ---------- */
const BRAND = [
  ['--navy-900', '#0E2A6B', 'Primária: botões sólidos, títulos, header escuro'],
  ['--navy-800', '#12296A', 'Hover da primária, início do gradiente'],
  ['--sky-500', '#29ABE2', 'Turquesa da marca: rota, estados ativos'],
  ['--sky-400', '#2DBFE8', 'Turquesa clara (sobre navy)'],
  ['--sky-ink', '#0F6A94', 'Turquesa acessível: texto/botão em fundo claro'],
];
const LIGHT = [
  ['--bg', '#F4F6FA', 'Fundo das telas'],
  ['--surface', '#FFFFFF', 'Cards'],
  ['--text', '#0F172A', 'Texto principal'],
  ['--text-muted', '#475569', 'Texto secundário (7.58:1 — não é cinza claro)'],
  ['--border', '#E2E8F0', 'Divisórias decorativas'],
  ['--border-strong', '#6B7A90', 'Bordas de controles (passa 3:1)'],
];
const DARK = [
  ['--bg-dark', '#0A192F', 'Fundo do mapa'],
  ['--surface-dark', '#0F2540', 'Cards sobre o mapa'],
  ['--text-on-dark', '#FFFFFF', 'Texto sobre navy'],
  ['--text-muted-dark', '#B8C4D9', 'Texto secundário sobre navy (10:1)'],
];
const SEMANTIC = [
  ['--success', '#15803D', 'Confirmações'],
  ['--warning', '#B45309', 'Atenção'],
  ['--danger', '#B91C1C', 'Erros'],
];

const swatch = ([name, hex, use]) => `
  <div class="sgd-swatch">
    <div class="sgd-swatch__chip" style="background:${hex}"></div>
    <div class="sgd-swatch__meta">
      <code class="sgd-code">${name}</code>
      <span class="sgd-hex">${hex}</span>
      <span class="sgd-use">${use}</span>
    </div>
  </div>`;

const TYPE_SCALE = [
  ['--text-3xl', '2.25rem', 'display', 800, 'Encontre seu caminho'],
  ['--text-2xl', '1.75rem', 'display', 800, 'Portão 12'],
  ['--text-xl', '1.375rem', 'display', 700, 'Resumo da rota'],
  ['--text-lg', '1.125rem', 'display', 700, 'Título de card'],
  ['--text-base', '1rem', 'body', 400, 'Texto de corpo padrão do app.'],
  ['--text-sm', '0.875rem', 'body', 400, 'Texto secundário e legendas.'],
  ['--text-xs', '0.75rem', 'body', 500, 'RÓTULOS E MICROCÓPIA'],
];

const SPACING = [['--space-1', 4], ['--space-2', 8], ['--space-3', 12], ['--space-4', 16], ['--space-5', 24], ['--space-6', 32], ['--space-7', 48], ['--space-8', 64]];
const RADII = [['--radius-sm', 8], ['--radius-md', 12], ['--radius-lg', 16], ['--radius-xl', 20], ['--radius-2xl', 28]];

/* ---------- contrast audit table ---------- */
const PAIRS = [
  ['--text sobre --bg', '#0F172A', '#F4F6FA', 4.5],
  ['--text sobre --surface', '#0F172A', '#FFFFFF', 4.5],
  ['--text-muted sobre --surface', '#475569', '#FFFFFF', 4.5],
  ['--text-muted sobre --bg', '#475569', '#F4F6FA', 4.5],
  ['branco sobre --navy-900 (botão)', '#FFFFFF', '#0E2A6B', 4.5],
  ['--navy-900 sobre --sky-500', '#0E2A6B', '#29ABE2', 4.5],
  ['branco sobre --sky-500 ✗ proibido', '#FFFFFF', '#29ABE2', 4.5],
  ['branco sobre --sky-ink (alternativa)', '#FFFFFF', '#0F6A94', 4.5],
  ['--sky-ink sobre --surface', '#0F6A94', '#FFFFFF', 4.5],
  ['--sky-500 sobre --bg-dark (rota, gráfico)', '#29ABE2', '#0A192F', 3.0],
  ['--text-on-dark sobre --bg-dark', '#FFFFFF', '#0A192F', 4.5],
  ['--text-muted-dark sobre --bg-dark', '#B8C4D9', '#0A192F', 4.5],
  ['--success sobre --surface', '#15803D', '#FFFFFF', 4.5],
  ['--warning sobre --surface', '#B45309', '#FFFFFF', 4.5],
  ['--danger sobre --surface', '#B91C1C', '#FFFFFF', 4.5],
];

const contrastRows = PAIRS.map(([name, fg, bg, need]) => {
  const r = contrast(fg, bg);
  const pass = r >= need;
  const expected = name.includes('proibido');
  return `<tr>
    <td><span class="sgd-cdot" style="background:${bg};color:${fg}">Aa</span> ${name}</td>
    <td class="sgd-num">${r.toFixed(2)}:1</td>
    <td class="sgd-num">${need}:1</td>
    <td class="${pass ? 'sgd-pass' : (expected ? 'sgd-expected' : 'sgd-fail')}">${pass ? 'PASSA' : (expected ? 'FALHA (esperado)' : 'FALHA')}</td>
  </tr>`;
}).join('');

/* ---------- page ---------- */
export function renderStyleguide() {
  return `
  <div class="sgd-page sg-ds">
    <div class="sgd-head">
      <h1 class="sgd-h1">SkyGate — Design System v5</h1>
      <p class="sgd-note">
        Tokens em <code class="sgd-code">styles/tokens.css</code> ·
        CSS em <code class="sgd-code">styles/components.css</code> ·
        Markup em <code class="sgd-code">src/components/ds/</code>.
        Tudo escopado em <code class="sgd-code">.sg-ds</code> — ainda não afeta o app.
      </p>
    </div>

    ${section('Marca', `A logo abaixo é <code class="sgd-code">assets/logo.png</code>. Não há SVG no repositório: a versão branca é o mesmo PNG com <code class="sgd-code">filter: brightness(0) invert(1)</code>, ou seja, uma silhueta chapada — substituto temporário. Troque em <code class="sgd-code">src/components/ds/Header.js</code> (constante <code class="sgd-code">LOGO_SRC</code>).`, `
      ${row(`
        <div class="sgd-logo-tile"><img src="assets/logo.png" alt="Logo SkyGate" style="height:44px"></div>
        <div class="sgd-logo-tile sgd-logo-tile--dark"><img src="assets/logo.png" alt="Logo SkyGate em branco" style="height:44px;filter:brightness(0) invert(1)"></div>
      `)}
      <div class="sgd-grad" style="background:var(--brand-gradient)">--brand-gradient</div>
    `)}

    ${section('Cores da marca', '', BRAND.map(swatch).join(''))}
    ${section('Neutros — tema claro', 'Telas de interface: home, resumo, listas, chegada.', LIGHT.map(swatch).join(''))}
    ${section('Neutros — tema escuro', 'Área de mapa/navegação, para a rota turquesa brilhar.', DARK.map(swatch).join(''))}
    ${section('Semânticas', 'Todas acima de 4.5:1 sobre --surface e --bg.', SEMANTIC.map(swatch).join(''))}

    ${section('Contraste WCAG AA', 'Calculado ao vivo nesta página. A linha “proibido” documenta a combinação que <em>não</em> se pode usar: o turquesa da marca não carrega texto branco.', `
      <table class="sgd-table">
        <thead><tr><th>Par</th><th>Medido</th><th>Mínimo</th><th>Resultado</th></tr></thead>
        <tbody>${contrastRows}</tbody>
      </table>
    `)}

    ${section('Tipografia', 'Títulos em Plus Jakarta Sans, corpo em Inter.', TYPE_SCALE.map(([tok, size, fam, weight, sample]) => `
      <div class="sgd-type">
        <div class="sgd-type__meta"><code class="sgd-code">${tok}</code><span class="sgd-hex">${size} · ${weight}</span></div>
        <div style="font-family:var(--font-${fam});font-size:var(${tok});font-weight:${weight};line-height:1.2">${sample}</div>
      </div>`).join(''))}

    ${section('Espaçamento', 'Base 4px.', `<div class="sgd-scale">${SPACING.map(([t, v]) => `
      <div class="sgd-scale__item"><div class="sgd-scale__bar" style="width:${v}px"></div><code class="sgd-code">${t}</code><span class="sgd-hex">${v}px</span></div>`).join('')}</div>`)}

    ${section('Raios', 'Cards bem arredondados (20px).', row(RADII.map(([t, v]) => `
      <div class="sgd-radius" style="border-radius:${v}px"><code class="sgd-code">${t}</code><span class="sgd-hex">${v}px</span></div>`).join('')))}

    ${section('Elevação', '', row(['elev-1', 'elev-2', 'elev-3'].map(e => `
      <div class="sgd-elev" style="box-shadow:var(--${e})"><code class="sgd-code">--${e}</code></div>`).join('')))}

    ${section('Button', 'Variações primary / gradient / outline / ghost, com ícone, tamanho pequeno, bloco e desabilitado.', `
      ${row(`
        ${Button({ label: 'Primary', variant: 'primary' })}
        ${Button({ label: 'Gradient', variant: 'gradient' })}
        ${Button({ label: 'Outline', variant: 'outline' })}
        ${Button({ label: 'Ghost', variant: 'ghost' })}
      `)}
      ${row(`
        ${Button({ label: 'Iniciar navegação', variant: 'primary', icon: 'solar:map-arrow-right-bold' })}
        ${Button({ label: 'Ver rota', variant: 'outline', iconRight: 'solar:alt-arrow-right-linear' })}
        ${Button({ label: 'Pequeno', variant: 'primary', size: 'sm' })}
        ${Button({ label: 'Desabilitado', variant: 'primary', disabled: true })}
      `)}
      ${Button({ label: 'Largura total', variant: 'gradient', block: true, icon: 'solar:routing-2-bold' })}
    `)}

    ${section('IconButton', 'FABs do mapa e ações do header. <strong>aria-label é obrigatório</strong> — o componente registra erro no console se faltar. 44×44px.', row(`
      ${IconButton({ icon: 'solar:question-circle-bold', label: 'Ajuda' })}
      ${IconButton({ icon: 'solar:map-arrow-right-bold', label: 'Recentralizar', variant: 'solid' })}
      ${IconButton({ icon: 'solar:layers-bold', label: 'Trocar piso', variant: 'teal' })}
      ${IconButton({ icon: 'solar:close-circle-bold', label: 'Fechar', variant: 'ghost' })}
      ${IconButton({ icon: 'solar:minus-circle-bold', label: 'Afastar', disabled: true })}
    `))}

    ${section('Card', '', row(`
      ${Card({ title: 'Portão 12', body: 'Terminal 1 · Piso 2 · 8 min de caminhada.', className: 'sgd-w' })}
      ${Card({ title: 'Sem sombra', body: 'Variação flat, para listas densas.', variant: 'flat', className: 'sgd-w' })}
      ${Card({ title: 'Elevado', body: 'Variação raised, para conteúdo flutuante.', variant: 'raised', className: 'sgd-w' })}
    `))}

    ${section('Chip', 'Outline usa --sky-ink, não --sky-500 (o turquesa puro falharia como texto pequeno).', row(`
      ${Chip({ label: 'Piso 1' })}
      ${Chip({ label: 'Rota mais rápida', variant: 'outline', icon: 'solar:bolt-bold' })}
      ${Chip({ label: 'Acessível', variant: 'outline', icon: 'solar:wheelchair-bold' })}
      ${Chip({ label: 'Selecionado', variant: 'active' })}
      ${Chip({ label: 'Aberto', variant: 'success' })}
      ${Chip({ label: 'Lotado', variant: 'warning' })}
      ${Chip({ label: 'Fechado', variant: 'danger' })}
      ${Chip({ label: 'Clicável', interactive: true, icon: 'solar:filter-bold' })}
    `))}

    ${section('Metric', 'O trio tempo / passos / piso. Cada métrica é anunciada como uma frase só.', `
      ${Card({ html: MetricGroup([
        Metric({ icon: 'solar:clock-circle-bold', value: '8', unit: 'min', label: 'Tempo' }),
        Metric({ icon: 'solar:walking-round-bold', value: '412', label: 'Passos' }),
        Metric({ icon: 'solar:layers-bold', value: '2', label: 'Piso' }),
      ]) })}
    `)}

    ${section('Header', 'Versão clara e versão escura, com slots de voltar e ajuda.', `
      <div class="sgd-frame">${Header({ title: 'SkyGate', subtitle: 'FOR · Aeroporto de Fortaleza', onHelp: true })}</div>
      <div class="sgd-frame">${Header({ title: 'Navegação', subtitle: 'Portão 12', theme: 'dark', onBack: true, onHelp: true })}</div>
      <div class="sgd-frame">${Header({ title: 'SkyGate', subtitle: 'Gradiente da marca', theme: 'gradient', onBack: true, onHelp: true })}</div>
    `)}

    ${section('StepRail', 'Progresso da navegação, exposto como progressbar.', `
      ${Card({ html: StepRail({ current: 3, total: 8 }) })}
      <div style="height:12px"></div>
      ${Card({ html: StepRail({ current: 1, total: 4 }) })}
    `)}

    ${section('Sheet', 'Bottom sheet com alcinha. Mostrado nos dois temas.', `
      <div class="sgd-frame sgd-frame--sheet">
        ${Sheet({ title: 'Portão 12', body: 'Siga em frente por 40 metros e vire à direita no duty free.',
          html: `<div style="margin-top:16px">${Button({ label: 'Iniciar navegação', variant: 'primary', block: true, icon: 'solar:map-arrow-right-bold' })}</div>` })}
      </div>
      <div class="sgd-frame sgd-frame--sheet sg-ds-dark">
        ${Sheet({ title: 'Em rota', body: 'Vire à esquerda após a escada rolante.',
          html: `<div style="margin-top:16px">${StepRail({ current: 5, total: 9 })}</div>` })}
      </div>
    `)}

    ${section('Tema escuro (área de mapa)', 'Mesmos componentes dentro de <code class="sgd-code">.sg-ds-dark</code> — os tokens são remapeados, o markup não muda.', `
      <div class="sgd-dark-stage sg-ds-dark">
        ${row(`
          ${Button({ label: 'Primary', variant: 'primary' })}
          ${Button({ label: 'Outline', variant: 'outline' })}
          ${Button({ label: 'Ghost', variant: 'ghost' })}
          ${IconButton({ icon: 'solar:layers-bold', label: 'Trocar piso', variant: 'teal' })}
          ${IconButton({ icon: 'solar:map-arrow-right-bold', label: 'Recentralizar' })}
        `)}
        <div style="height:16px"></div>
        ${row(`${Chip({ label: 'Piso 2' })} ${Chip({ label: 'Rota ativa', variant: 'outline' })}`)}
        <div style="height:16px"></div>
        ${Card({ html: MetricGroup([
          Metric({ icon: 'solar:clock-circle-bold', value: '4', unit: 'min', label: 'Restante' }),
          Metric({ icon: 'solar:signpost-bold', value: '3', label: 'Passo' }),
          Metric({ icon: 'solar:layers-bold', value: '2', label: 'Piso' }),
        ]) })}
      </div>
    `)}

    ${section('Foco visível', 'Navegue de <kbd class="sgd-kbd">Tab</kbd> por esta página: todo elemento clicável recebe um anel de foco de 2 camadas, visível em fundo claro e escuro.', row(`
      ${Button({ label: 'Foque em mim', variant: 'primary' })}
      ${Button({ label: 'E em mim', variant: 'outline' })}
      ${IconButton({ icon: 'solar:star-bold', label: 'Favoritar' })}
      ${Chip({ label: 'Chip clicável', interactive: true })}
    `))}
  </div>`;
}

document.getElementById('styleguide').innerHTML = renderStyleguide();
