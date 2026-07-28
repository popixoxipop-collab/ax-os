const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

// ---------------------------------------------------------------------------
// data-arch-* stamping (element-editor contract, plan §3.1).
//
// Every rendered diagram element is wrapped in
//   <g data-arch-id="…" data-arch-kind="…" data-arch-part="…">…</g>
// so a DOM hit can be mapped back to its source JSON entry:
// - collections with a source id (nodes/lanes/phases/groups/components/
//   participants/states) use that id verbatim;
// - id-less collections use derived ids: `e:<from>-><to>:<index>` for
//   edges/flows/transitions, `m:<from>-><to>:<index>` for messages, and
//   `seg:<i>` / `act:<i>` / `card:<i>` / `stage:<i>` / `boundary:<i>` for the
//   rest (index = position in the source array);
// - when one logical element is emitted as discontinuous clusters (an edge's
//   path is drawn before nodes, its label after), the clusters share the same
//   data-arch-id and differ only by data-arch-part (`path` / `label`).
// Wrappers enclose one contiguous cluster in place, so SVG paint order is
// untouched. Attributes are inert: they change no rendering and no styling.
//
// Ids are schema-constrained (^[a-zA-Z][a-zA-Z0-9_-]*$) plus our own `:>-`
// derived syntax, so `->` may appear literally (legal inside a quoted HTML
// attribute); only `&` and `"` would need escaping, and we do so defensively.
const archAttrEsc = (value) => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');

export function archAttrs(id, kind, part = 'body') {
  return `data-arch-id="${archAttrEsc(id)}" data-arch-kind="${archAttrEsc(kind)}" data-arch-part="${archAttrEsc(part)}"`;
}

// Wraps one contiguous emitted cluster. Empty content stays empty so optional
// emitters (labels, rails) keep producing the exact same blank lines as before.
export function archWrap(id, kind, part, content) {
  if (content == null || content === '') return '';
  return `        <g ${archAttrs(id, kind, part)}>\n${content}\n        </g>`;
}

export function archEdgeId(edge, index) {
  return `e:${edge.from}->${edge.to}:${index}`;
}

export function archMessageId(message, index) {
  return `m:${message.from}->${message.to}:${index}`;
}

export function renderDefinitions() {
  return `        <!-- Definitions -->
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-default" />
          </marker>
          <marker id="arrowhead-emphasis" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-emphasis" />
          </marker>
          <marker id="arrowhead-security" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-security" />
          </marker>
          <marker id="arrowhead-dashed" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-dashed" />
          </marker>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" class="c-grid" stroke-width="0.5"/>
          </pattern>
        </defs>`;
}

export function renderCards(cards) {
  const list = Array.isArray(cards) ? cards : [];
  return `    <!-- Info Cards -->
    <div class="cards">
${list.map((card, index) => `      <div class="card" ${archAttrs(`card:${index}`, 'card')}>
        <div class="card-header">
          <div class="card-dot ${esc(card.dot)}"></div>
          <h3>${esc(card.title)}</h3>
        </div>
        <ul>
${card.items.map((item) => `          <li>&bull; ${esc(item)}</li>`).join('\n')}
        </ul>
      </div>`).join('\n\n')}
    </div>`;
}

const SVG_SLOT_RE = /      <!-- ARCHIFY:SVG_SLOT_START -->[\s\S]*?      <!-- ARCHIFY:SVG_SLOT_END -->/;
const CARDS_SLOT_RE = /    <!-- ARCHIFY:CARDS_SLOT_START -->[\s\S]*?    <!-- ARCHIFY:CARDS_SLOT_END -->/;
const SOURCE_SLOT_RE = /    <!-- ARCHIFY:SOURCE_SLOT_START -->[\s\S]*?    <!-- ARCHIFY:SOURCE_SLOT_END -->/;

// Embedded source (element-editor contract, plan §3.2): the rendered HTML
// carries its own spec, so any archify output round-trips to editable JSON
// without a sidecar file. Escaping every `<` as its JSON unicode escape
// (u003c) keeps the payload valid JSON (JSON.parse of the script's
// textContent returns the exact source) while
// guaranteeing the block contains no `</script>` — or any tag opener — that
// could terminate it early or confuse tag-counting checks like single_svg.
// The sentinels are kept in the output so tools can locate and replace the
// slot in already-rendered files. An absent source leaves the slot empty,
// which is the valid hand-placed-fallback shape.
function renderSourceSlot(source) {
  if (!source || source.json == null) {
    return '    <!-- ARCHIFY:SOURCE_SLOT_START --><!-- ARCHIFY:SOURCE_SLOT_END -->';
  }
  const json = JSON.stringify(source.json).replace(/</g, '\\u003c');
  const version = source.version ? ` data-archify-version="${esc(source.version)}"` : '';
  return `    <!-- ARCHIFY:SOURCE_SLOT_START --><script type="application/json" id="archify-source" data-archify-type="${esc(source.type)}"${version}>${json}</script><!-- ARCHIFY:SOURCE_SLOT_END -->`;
}

const TEMPLATE_PLACEHOLDERS = [
  '<title>[PROJECT NAME] Architecture Diagram</title>',
  '<h1>[PROJECT NAME] Architecture</h1>',
  '<p class="subtitle">[Subtitle description]</p>',
  '[Project Name] &bull; [Additional metadata]',
];

// `footer` is injected as raw HTML so callers can embed <kbd> hints;
// pass only trusted strings here, never user input.
export function applyTemplate(template, { title, subtitle, footer, svg, cards, source }) {
  if (!SVG_SLOT_RE.test(template)) {
    throw new Error('applyTemplate: template missing ARCHIFY:SVG_SLOT sentinel');
  }
  if (!CARDS_SLOT_RE.test(template)) {
    throw new Error('applyTemplate: template missing ARCHIFY:CARDS_SLOT sentinel');
  }
  if (!SOURCE_SLOT_RE.test(template)) {
    throw new Error('applyTemplate: template missing ARCHIFY:SOURCE_SLOT sentinel');
  }
  for (const ph of TEMPLATE_PLACEHOLDERS) {
    if (!template.includes(ph)) {
      throw new Error(`applyTemplate: template missing placeholder ${JSON.stringify(ph)}`);
    }
  }
  // Function replacers: a literal `$&`, `$'`, `$\`` or `$$` in titles, labels,
  // or rendered SVG must not be interpreted as a replacement pattern.
  return template
    .replace(TEMPLATE_PLACEHOLDERS[0], () => `<title>${esc(title)} Diagram</title>`)
    .replace(TEMPLATE_PLACEHOLDERS[1], () => `<h1 ${archAttrs('meta:title', 'meta-title')}>${esc(title)}</h1>`)
    .replace(TEMPLATE_PLACEHOLDERS[2], () => `<p class="subtitle" ${archAttrs('meta:subtitle', 'meta-subtitle')}>${esc(subtitle ?? '')}</p>`)
    .replace(SVG_SLOT_RE, () => svg)
    .replace(CARDS_SLOT_RE, () => cards)
    .replace(SOURCE_SLOT_RE, () => renderSourceSlot(source))
    .replace(TEMPLATE_PLACEHOLDERS[3], () => footer);
}

// CJK and other fullwidth glyphs render at roughly twice the advance width of
// ASCII in the monospace stacks the template uses. Includes the supplementary
// CJK extensions and emoji, which also render double-width.
const FULLWIDTH_RE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦　-〿\u{1F000}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

export function textUnits(text) {
  let units = 0;
  for (const ch of String(text ?? '')) units += FULLWIDTH_RE.test(ch) ? 2 : 1;
  return units;
}
