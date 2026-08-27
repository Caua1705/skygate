/**
 * normalize-floor-svgs — give every floor plan ONE vocabulary.
 *
 *   node scripts/normalize-floor-svgs.mjs [--dry-run]
 *
 * WHY THIS EXISTS. The four Fortaleza plans were drawn in Figma by hand and
 * exported with whatever layer names the designer happened to use. Nothing is
 * consistent between them: the terminal container is "for-t1-ps" on floor 0,
 * "for-t1-p0" on floor 1, "for-t1-p1" on floor 2 and simply absent on floor 3;
 * the walls are "paredes" on floor 2 and "parede" on floor 1; the floor slab
 * has a semantic name on floors 1 and 2 and none at all on floors 0 and 3.
 * Styling that directly means a stylesheet full of [id="…"] selectors that
 * break on the next re-export.
 *
 * So the naming is normalised ONCE, here, at build time: every structural
 * element gets a class from a single fixed vocabulary, and the stylesheet
 * addresses classes only.
 *
 *   IN   assets/floors/lite/{0,1,2,3}.svg   (filters stripped; never written)
 *   OUT  assets/floors/{0,1,2,3}.svg        (what the app fetches)
 *
 * IDEMPOTENT. The input directory is never the output directory, so a re-run
 * always starts from the same bytes. Any sg-* class already on the input is
 * stripped before tagging anyway, so the script is safe to point anywhere.
 *
 * RE-RUN IT whenever a plan is re-exported from Figma. If a layer was renamed,
 * the run prints the categories that came back empty for that floor — that
 * report is the point, not a warning to skim past.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = floor => join(ROOT, 'assets', 'floors', 'lite', `${floor}.svg`);
const OUT = floor => join(ROOT, 'assets', 'floors', `${floor}.svg`);
const FLOORS = ['0', '1', '2', '3'];

/* ══════════════════════════════════════════════════════════════════
   THE VOCABULARY — the only class names the stylesheet may rely on.
   ══════════════════════════════════════════════════════════════════ */
const VOCAB = [
  'sg-floor',      // the terminal slab, one continuous surface
  'sg-facade',     // the outline edge drawn under the slab
  'sg-walls',      // internal walls
  'sg-areas',      // floor areas, seating decks
  'sg-outside',    // street, apron, aircraft, car park — context only
  'sg-retail',     // shops
  'sg-vacant',     // empty units
  'sg-food',       // bars and restaurants
  'sg-gate',       // boarding gates
  'sg-restroom',   // toilets
  'sg-vertical',   // stairs, escalators, lifts
  'sg-security',   // x-ray, detectors, passport control
  'sg-airline',    // airline desks
  'sg-mobility',   // mobility and accessibility services
  // Two additions the drawings force, beyond the requested list:
  'sg-pictogram',  // the floating badge glyphs, hidden by the stylesheet
  'sg-artboard',   // the full-canvas rect Figma opens every export with
];

/* ══════════════════════════════════════════════════════════════════
   TABLE 1 — names that are IDENTICAL on all four floors.

   Verified against all four inventories. `exact` matches the whole id;
   `prefix` matches the start; `contains` exists for one case only: Figma
   layers literally named  id="elevador_12"  whose quotes survived the export
   as mojibake, so the id reads  id=Ã«levador_12&quot;  and has no usable start.
   ══════════════════════════════════════════════════════════════════ */
const SHARED = [
  ['sg-outside',   { exact: ['bg', 'Avioes e tuneis'] }],
  ['sg-retail',    { prefix: ['retail_'] }],
  ['sg-food',      { prefix: ['fb_'] }],
  ['sg-gate',      { prefix: ['gate_'] }],
  ['sg-airline',   { prefix: ['airlines_'] }],
  ['sg-mobility',  { prefix: ['mobility_'] }],
  ['sg-restroom',  { prefix: ['sanitarios', 'sanitário', 'sanitÃ¡rio'], exact: ['banheiro'] }],
  ['sg-vertical',  { prefix: ['escada', 'Escada', 'elevador'], contains: ['levador_'] }],
  ['sg-security',  { prefix: ['Raio-X', 'X-ray', 'detectores', 'Controle de Passaporte', 'Passaport'] }],
  ['sg-pictogram', { prefix: ['Icone', 'icon', 'shopping-bag-', 'restaurant-'] }],
];

/* ══════════════════════════════════════════════════════════════════
   TABLE 2 — names that DIFFER per floor. One block per floor, exact ids.

   Read this as the record of what each drawing actually contains. An empty
   array is information: floor 0 draws no walls as a named layer, floor 3
   draws no interior areas at all. Deliberately NOT filled in by guessing.

   The terminal containers (for-t1-ps / for-t1-p0 / for-t1-p1) are absent on
   purpose: they wrap the whole floor, so tagging one would hand every unit
   inside it a second, competing class.
   ══════════════════════════════════════════════════════════════════ */
const PER_FLOOR = {
  '0': {
    'sg-walls':    [],
    'sg-areas':    [],
    'sg-retail':   [],
    'sg-vacant':   [],
    // Check-in is an airline counter by any other name.
    'sg-airline':  ['checkin'],
  },
  '1': {
    'sg-walls':    ['parede'],
    'sg-areas':    ['areas'],
    'sg-retail':   [],
    'sg-vacant':   ['vago'],
    'sg-airline':  ['checkin'],
    // NOT 'acessivel' -> sg-mobility, though the name invites it: that layer
    // is a CONTAINER holding sanitário_01, sanitarios_03 and their fixtures —
    // the accessible toilet block, not a mobility service point. Tagging it
    // took 69 shapes away from sg-restroom, because a container class outranks
    // nothing and simply wins on source order. Left to the catch-all; its
    // sanitarios_* children carry the right tone on their own.
  },
  '2': {
    'sg-walls':    ['paredes'],
    'sg-areas':    ['pisos areas', 'piso_cadeiras'],
    'sg-retail':   ['lojas'],
    'sg-vacant':   ['lojas vazias'],
  },
  '3': {
    'sg-walls':    [],
    'sg-areas':    [],
    'sg-retail':   [],
    'sg-vacant':   [],
  },
  // DELIBERATELY LEFT OUT, pending a vocabulary decision:
  //   esteira_04*   floor 1, 226 shapes — the baggage reclaim carousels. The
  //                 single biggest unclassified block in any of the four
  //                 drawings, and there is no class for "baggage" yet.
  //   cancela       floor 1, 34 shapes — the exit barriers.
  //   orgaospublicos_*  floors 0/1/3 — federal police, customs. On floor 2
  //                 these sit inside "lojas" and inherit sg-retail, which is
  //                 wrong but invisible; elsewhere they fall to the catch-all.
  //   ícones fixos  floor 3, 14 shapes — a tray of fixed pictograms.
};

/* ══════════════════════════════════════════════════════════════════
   TABLE 3 — sg-floor and sg-facade are found GEOMETRICALLY, not by name.

   Floors 0 and 3 have no semantic name for the slab (it sits inside
   "Vector_22" and "fachada_2"), so a name table cannot reach it. Picking it by
   its fill would be a selector built on a colour accident.

   THE CRITERION, in full:
     1. Consider every filled <path> with a substantial outline (d >= 300
        chars) that is NOT inside the outdoor subtrees (bg, Avioes e tuneis).
     2. Take the largest by bounding-box area. That is the terminal outline.
     3. Collect its TWINS: candidates whose bbox width AND height are within
        2% of it. These are the same outline drawn several times, a few units
        apart, which is how the export fakes a raised floor.
     4. Paint order decides: the LAST twin drawn is the surface the eye sees,
        so it becomes sg-floor. Every earlier twin is underneath it and
        becomes sg-facade.

   VALIDATION. On floor 2, where the answer is known independently, this picks
   exactly the path inside "Piso" for the slab and the one inside "fachada" for
   the edge. On floor 1 it picks "térreo" over "piso" — both are the same
   outline in the same colour and "térreo" is painted on top, so it is the one
   actually visible. The run prints the choice for every floor.
   ══════════════════════════════════════════════════════════════════ */
const OUTDOOR_ROOTS = new Set(['bg', 'Avioes e tuneis']);
const MIN_OUTLINE_CHARS = 300;
const TWIN_TOLERANCE = 0.02;

/* ── SVG path geometry ─────────────────────────────────────────── */
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Absolute points a path visits. Commands have different arities and the
 *  lowercase ones are relative — pairing the numbers blindly puts every shape
 *  near the origin and makes the whole geometric criterion meaningless. */
function pathPoints(d) {
  const tk = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const pts = [];
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, cmd = null;
  while (i < tk.length) {
    if (/[A-Za-z]/.test(tk[i])) { cmd = tk[i]; i += 1; }
    if (!cmd) break;
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    const n = ARITY[up];
    if (n === undefined) break;
    if (up === 'Z') { cx = sx; cy = sy; pts.push([cx, cy]); continue; }
    const a = tk.slice(i, i + n).map(Number);
    if (a.length < n || a.some(v => !Number.isFinite(v))) break;
    i += n;
    if (up === 'H') cx = rel ? cx + a[0] : a[0];
    else if (up === 'V') cy = rel ? cy + a[0] : a[0];
    else if (up === 'A') { cx = rel ? cx + a[5] : a[5]; cy = rel ? cy + a[6] : a[6]; }
    else { cx = rel ? cx + a[n - 2] : a[n - 2]; cy = rel ? cy + a[n - 1] : a[n - 1]; }
    if (up === 'M') { sx = cx; sy = cy; cmd = rel ? 'l' : 'L'; }
    pts.push([cx, cy]);
  }
  return pts;
}

/* ── A tolerant element tree, good enough for these exports ─────── */
const VOID = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'image', 'use', 'stop'];

function parse(svg) {
  const root = { tag: 'root', attrs: '', children: [], parent: null, start: 0, tagEnd: 0 };
  let cur = root;
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, self] = m;
    if (close) { if (cur.parent) cur = cur.parent; continue; }
    const node = {
      tag, attrs, children: [], parent: cur,
      start: m.index, tagEnd: m.index + m[0].length,
    };
    cur.children.push(node);
    if (!self && !VOID.includes(tag)) cur = node;
  }
  return root;
}

const idOf = node => (/\sid="([^"]*)"/.exec(node.attrs) || [])[1] || '';

function matches(id, rule) {
  if (!id) return false;
  if (rule.exact?.includes(id)) return true;
  if (rule.prefix?.some(p => id.startsWith(p))) return true;
  if (rule.contains?.some(p => id.includes(p))) return true;
  return false;
}

/** Steps 1-4 of the criterion documented in TABLE 3. */
function findSlabAndFacade(root) {
  const found = [];
  (function walk(node, outdoors) {
    const here = outdoors || OUTDOOR_ROOTS.has(idOf(node));
    if (node.tag === 'path' && !here) {
      const fill = (/\sfill="([^"]*)"/.exec(node.attrs) || [])[1];
      const d = (/\sd="([^"]*)"/.exec(node.attrs) || [])[1];
      if (fill && fill !== 'none' && d && d.length >= MIN_OUTLINE_CHARS) {
        const pts = pathPoints(d).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
        if (pts.length > 20) {
          const xs = pts.map(p => p[0]);
          const ys = pts.map(p => p[1]);
          const w = Math.max(...xs) - Math.min(...xs);
          const h = Math.max(...ys) - Math.min(...ys);
          let owner = '';
          for (let a = node.parent; a; a = a.parent) { const id = idOf(a); if (id) { owner = id; break; } }
          found.push({ node, owner, fill, w, h, area: w * h });
        }
      }
    }
    for (const c of node.children) walk(c, here);
  })(root, false);

  if (!found.length) return { slab: null, facades: [], twins: [] };
  const biggest = found.slice().sort((a, b) => b.area - a.area)[0];
  const twins = found
    .filter(x => Math.abs(x.w - biggest.w) / biggest.w < TWIN_TOLERANCE
      && Math.abs(x.h - biggest.h) / biggest.h < TWIN_TOLERANCE)
    .sort((a, b) => a.node.start - b.node.start);
  return { slab: twins.at(-1), facades: twins.slice(0, -1), twins };
}

/* ── Tagging ────────────────────────────────────────────────────── */
function normalise(floor, svgIn) {
  // Defensive: never inherit a class from whatever we were pointed at.
  const svg = svgIn.replace(/\sclass="sg-[^"]*"/g, '');
  const root = parse(svg);
  const perFloor = PER_FLOOR[floor] ?? {};
  const rules = [
    ...SHARED,
    ...Object.entries(perFloor)
      .filter(([, names]) => names.length)
      .map(([cls, names]) => [cls, { exact: names }]),
  ];

  const assign = new Map();   // node -> class
  const tally = Object.fromEntries(VOCAB.map(c => [c, 0]));

  (function walk(node) {
    const id = idOf(node);
    if (id) {
      for (const [cls, rule] of rules) {
        if (matches(id, rule)) { assign.set(node, cls); tally[cls] += 1; break; }
      }
    }
    for (const c of node.children) walk(c);
  })(root);

  // The artboard: Figma opens every export with a full-canvas rect. It is the
  // paper, not the building, and the stylesheet has to be able to erase it.
  const svgEl = root.children.find(n => n.tag === 'svg');
  const rootGroup = svgEl?.children.find(n => n.tag === 'g');
  const artboard = rootGroup?.children.find(n => n.tag === 'rect' || (n.tag === 'path' && /\bd="M0 0h\d+v\d+H0z"/.test(n.attrs)));
  if (artboard) { assign.set(artboard, 'sg-artboard'); tally['sg-artboard'] += 1; }

  const { slab, facades, twins } = findSlabAndFacade(root);
  if (slab) { assign.set(slab.node, 'sg-floor'); tally['sg-floor'] += 1; }
  for (const f of facades) { assign.set(f.node, 'sg-facade'); tally['sg-facade'] += 1; }

  // Apply back-to-front so earlier offsets stay valid.
  const edits = [...assign.entries()]
    .map(([node, cls]) => ({ at: node.start + 1 + node.tag.length, cls }))
    .sort((a, b) => b.at - a.at);
  let out = svg;
  for (const { at, cls } of edits) out = `${out.slice(0, at)} class="${cls}"${out.slice(at)}`;

  return { out, tally, twins, slab, facades };
}

/* ── Run ────────────────────────────────────────────────────────── */
const dryRun = process.argv.includes('--dry-run');
console.log(dryRun ? 'DRY RUN — nada sera gravado\n' : 'Normalizando assets/floors/lite -> assets/floors\n');

const empties = {};
for (const floor of FLOORS) {
  const svg = readFileSync(SRC(floor), 'utf8');
  const { out, tally, twins, slab, facades } = normalise(floor, svg);

  console.log(`===== PISO ${floor}`);
  console.log(`  laje/fachada por geometria: ${twins.length} gemeos do contorno do terminal`);
  twins.forEach((t, i) => {
    const role = t === slab ? 'sg-floor ' : 'sg-facade';
    console.log(`     ${role}  ordem ${i}  fill ${(t.fill || '-').padEnd(9)} bbox ${t.w.toFixed(0)}x${t.h.toFixed(0)}  grupo Figma: "${t.owner}"`);
  });
  if (!slab) console.log('     !! nenhum contorno encontrado');

  const got = VOCAB.filter(c => tally[c] > 0);
  const missing = VOCAB.filter(c => tally[c] === 0);
  empties[floor] = missing;
  console.log('  classes atribuidas: ' + got.map(c => `${c}(${tally[c]})`).join('  '));
  console.log('  SEM COBERTURA neste piso: ' + (missing.length ? missing.join(', ') : '(nenhuma)'));

  if (!dryRun) writeFileSync(OUT(floor), out);
  console.log(`  ${dryRun ? 'nao gravado' : 'gravado ' + OUT(floor).replace(ROOT, '.')}  (${(out.length / 1024).toFixed(0)} KB)\n`);
}

console.log('RESUMO — categorias sem cobertura, por piso:');
for (const floor of FLOORS) {
  console.log(`  piso ${floor}: ${empties[floor].length ? empties[floor].join(', ') : '(todas cobertas)'}`);
}
