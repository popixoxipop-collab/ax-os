// ArchifyJsonAdapter — plan §3.4 class (a): archify-JSON-backed diagrams.
//
// Counterpart to dom-adapter.js's DomObjectAdapter. Same role in the shell —
// one object exposing load/enumerate/resolveHit/contextFor/opsSchema/apply/
// render/verify/serialize — so editor.js can drive either adapter. The
// difference class (a) forces: the authoritative state is the embedded source
// JSON (the SVG is a pure view), and re-rendering is deterministic but must run
// server-side because the renderers are spawn-per-run Node scripts (plan G4).
// That is what `archify serve` is for; render()/verify() POST to it and accept
// an injected base URL + fetch so tests can point at a spun-up serve.
//
// The three-layer scope guarantee of the design (D3) is preserved:
//   1) opsSchema      — pins the selected id with {"const": id} (and from/to for
//                       edges) so an out-of-scope op is unrepresentable.
//   2) apply          — code-level scope gate throwing ScopeViolation, plus ajv
//                       re-validation happens server-side on the next render.
//   3) bleedDiff      — before/after structural diff proving every OTHER
//                       data-arch-id cluster is byte-identical (legend + the
//                       embedded source + viewBox/auto-height whitelisted).
//
// No DOM and no dependencies: the file runs unchanged in the browser (classic
// script — shares the top-level `const` with editor.js like dom-adapter.js) and
// in Node (imported for its side effect; reads globalThis.ArchifyJsonAdapter).
const ArchifyJsonAdapter = (() => {
  const ID_PAT = '^[a-zA-Z][a-zA-Z0-9_-]*$';
  const COMPONENT_TYPES = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];
  const VARIANTS = ['default', 'emphasis', 'security', 'dashed'];
  const SIDES = ['left', 'right', 'top', 'bottom'];
  const ROUTES = ['auto', 'straight', 'drop', 'outside-right', 'return-left', 'bottom-channel', 'up-channel'];
  const POINT = { type: 'array', prefixItems: [{ type: 'number' }, { type: 'number' }], items: false, minItems: 2, maxItems: 2 };

  // Per-type primary collections + derived-edge id prefix (from the 5 renderers'
  // archWrap/archEdgeId/archMessageId call sites — see plan §3.1).
  const TYPE_FIELDS = {
    workflow:     { nodes: 'nodes',        edges: 'edges',       edgePrefix: 'e', nodeKind: 'node',        edgeKind: 'edge' },
    architecture: { nodes: 'components',   edges: 'connections', edgePrefix: 'e', nodeKind: 'component',   edgeKind: 'connection' },
    sequence:     { nodes: 'participants', edges: 'messages',    edgePrefix: 'm', nodeKind: 'participant', edgeKind: 'message' },
    dataflow:     { nodes: 'nodes',        edges: 'flows',       edgePrefix: 'e', nodeKind: 'node',        edgeKind: 'flow' },
    lifecycle:    { nodes: 'states',       edges: 'transitions', edgePrefix: 'e', nodeKind: 'state',       edgeKind: 'transition' },
  };

  const EDGE_KINDS = new Set(['edge', 'connection', 'flow', 'transition', 'message']);
  const META_KINDS = new Set(['meta-title', 'meta-subtitle']);

  // data-arch-id is only unique WITHIN a collection (schema pattern), NOT
  // globally — a lane and a node can share an id (e.g. workflow "trace"). The
  // stamp's data-arch-kind disambiguates, so every id lookup is kind-qualified
  // via this map (kind -> the source array that owns that id).
  const KIND_COLLECTION = {
    workflow:     { lane: 'lanes', phase: 'phases', group: 'groups', node: 'nodes', edge: 'edges' },
    architecture: { component: 'components', boundary: 'boundaries', connection: 'connections' },
    sequence:     { participant: 'participants', lifeline: 'participants', segment: 'segments', activation: 'activations', message: 'messages' },
    dataflow:     { stage: 'stages', node: 'nodes', flow: 'flows' },
    lifecycle:    { state: 'states', band: 'lanes', transition: 'transitions' },
  };

  // Index-addressed derived ids (position in a source array). Maps prefix -> field.
  const INDEX_PREFIX = { seg: 'segments', act: 'activations', stage: 'stages', boundary: 'boundaries', card: 'cards', band: 'lanes' };

  // Compact layout budgets summarised from the schemas + renderer layout
  // validators this adapter was built against (plan §4.1 — hundreds of tokens).
  const BUDGETS = {
    workflow: 'columns are integers 0..5 (fixed x); every node has a lane (existing lane id) and col; node.width>=32,height>=32 (default 92x52); the label must fit the node width (~6.8px/char) — overflow goes to sublabel; node.type in [frontend,backend,database,cloud,security,messagebus,external]; edges reference existing from/to node ids and route orthogonally; viewBox auto-fits height from lane count — never shrink it.',
    architecture: 'components carry an explicit box; connections reference existing component ids and route orthogonally; boundaries frame regions; keep labels short enough to fit; viewBox is fixed by meta.viewBox.',
    sequence: 'participants are ordered left-to-right with lifelines; messages reference existing participant ids in time order; keep message labels concise.',
    dataflow: 'stages are ordered columns; nodes sit in a stage; flows reference existing node ids; keep node labels within the box width.',
    lifecycle: 'states sit on lanes/bands; transitions reference existing state ids; keep transition labels short.',
  };

  // ------------------------------------------------------------------ endpoint
  let DEFAULT_ENDPOINT = { baseUrl: '', fetch: (typeof fetch !== 'undefined' ? fetch : null) };
  function setEndpoint(e) { DEFAULT_ENDPOINT = { ...DEFAULT_ENDPOINT, ...(e || {}) }; }
  function endpoint(opts = {}) {
    const baseUrl = opts.baseUrl != null ? opts.baseUrl : DEFAULT_ENDPOINT.baseUrl;
    const f = opts.fetch || DEFAULT_ENDPOINT.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!f) throw new Error('ArchifyJsonAdapter: no fetch available — pass opts.fetch (or call setEndpoint).');
    return { baseUrl, fetch: f };
  }

  // -------------------------------------------------------------- html helpers
  function regexEscape(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // data-* attribute values are escaped by archAttrEsc: & -> &amp;, " -> &quot;.
  function decodeAttr(v) { return String(v).replace(/&quot;/g, '"').replace(/&amp;/g, '&'); }

  function hasEmbeddedSource(htmlText) {
    return /<script[^>]*id="archify-source"[^>]*>[\s\S]*?<\/script>/.test(String(htmlText || ''));
  }

  // The embedded block escapes every '<' as its JSON unicode escape (<), so
  // it can contain no '<' — the first '</script>' is always the real terminator,
  // and JSON.parse turns the < escapes back into '<' automatically.
  function extractSource(htmlText) {
    const html = String(htmlText || '');
    const m = html.match(/<script[^>]*id="archify-source"[^>]*>([\s\S]*?)<\/script>/);
    if (!m) return null;
    const json = m[1].trim();
    if (!json) return null; // hand-placed fallback: empty slot
    const typeM = html.match(/id="archify-source"[^>]*data-archify-type="([^"]*)"/);
    const versionM = html.match(/id="archify-source"[^>]*data-archify-version="([^"]*)"/);
    let source;
    try { source = JSON.parse(json); } catch (err) {
      throw new Error('embedded archify source is not valid JSON: ' + err.message);
    }
    return {
      source,
      type: (typeM && typeM[1]) || source.diagram_type || null,
      version: versionM ? versionM[1] : null,
    };
  }

  // ------------------------------------------------------------------ stamps
  // Every stamped element carries the three attributes in fixed order (archAttrs),
  // whether it is a <g> (SVG), an <h1>/<p> (meta), or a <div> (card).
  function scanStamps(html) {
    const re = /data-arch-id="([^"]*)"\s+data-arch-kind="([^"]*)"\s+data-arch-part="([^"]*)"/g;
    const order = [];
    const byKey = new Map();
    let m;
    while ((m = re.exec(html)) !== null) {
      const id = decodeAttr(m[1]);
      const kind = decodeAttr(m[2]);
      const part = decodeAttr(m[3]);
      // Key on (kind, id) so a lane and a node sharing an id stay distinct.
      const key = kind + ' ' + id;
      if (!byKey.has(key)) { byKey.set(key, { id, kind, parts: [] }); order.push(key); }
      const entry = byKey.get(key);
      if (!entry.parts.includes(part)) entry.parts.push(part);
    }
    return order.map((k) => byKey.get(k));
  }

  // --------------------------------------------------------------- source index
  function fields(type) { return TYPE_FIELDS[type] || TYPE_FIELDS.workflow; }

  function findById(source, id) {
    for (const [key, value] of Object.entries(source || {})) {
      if (!Array.isArray(value)) continue;
      const index = value.findIndex((o) => o && typeof o === 'object' && o.id === id);
      if (index >= 0) return { obj: value[index], collection: key, index };
    }
    return null;
  }

  function parseDerivedEdgeId(id) {
    const m = /^([a-z]+):(.+)->(.+):(\d+)$/.exec(id);
    if (!m) return null;
    return { prefix: m[1], from: m[2], to: m[3], index: Number(m[4]) };
  }

  // Resolve the source object (and its collection/index) backing a stamped id.
  // `kind` (the stamp's data-arch-kind) disambiguates cross-collection id
  // collisions and is used whenever available.
  function locate(model, id, kind) {
    const { source, type } = model;
    if (id === 'legend' || id === 'rail') return { obj: null, synthetic: true };
    if (id === 'meta:title') return { obj: source.meta, collection: 'meta', metaKey: 'title' };
    if (id === 'meta:subtitle') return { obj: source.meta, collection: 'meta', metaKey: 'subtitle' };

    const edge = parseDerivedEdgeId(id);
    if (edge) {
      const coll = fields(type).edges;
      const arr = source[coll] || [];
      let obj = arr[edge.index];
      if (!obj || obj.from !== edge.from || obj.to !== edge.to) {
        obj = arr.find((e) => e && e.from === edge.from && e.to === edge.to) || obj || null;
      }
      const index = obj ? arr.indexOf(obj) : edge.index;
      return { obj, collection: coll, index, derived: true, from: edge.from, to: edge.to };
    }

    const idxMatch = /^([a-z]+):(\d+)$/.exec(id);
    if (idxMatch && INDEX_PREFIX[idxMatch[1]]) {
      const coll = INDEX_PREFIX[idxMatch[1]];
      const index = Number(idxMatch[2]);
      return { obj: (source[coll] || [])[index] || null, collection: coll, index, derived: true };
    }

    // Kind-qualified: look inside the collection the kind names (id is unique
    // there), so a node "trace" is never confused with a lane "trace".
    const kc = kind && KIND_COLLECTION[type] && KIND_COLLECTION[type][kind];
    if (kc && Array.isArray(source[kc])) {
      const index = source[kc].findIndex((o) => o && o.id === id);
      if (index >= 0) return { obj: source[kc][index], collection: kc, index, derived: false };
    }

    const hit = findById(source, id);
    if (hit) return { ...hit, derived: false };
    return { obj: null, unknown: true };
  }

  function labelOf(loc, id) {
    if (!loc || !loc.obj) return id;
    if (loc.metaKey) return loc.obj[loc.metaKey] || id;
    return loc.obj.label || loc.obj.title || loc.obj.text || id;
  }

  // ------------------------------------------------------------------ load
  function load(htmlText) {
    if (!hasEmbeddedSource(htmlText)) {
      const err = new Error('This diagram has no embedded archify source (#archify-source is empty). It was hand-placed or produced by an older renderer, so class (a) JSON editing is unavailable. Re-render it with `archify render` to enable editing.');
      err.name = 'NoEmbeddedSource';
      throw err;
    }
    const extracted = extractSource(htmlText);
    if (!extracted) {
      const err = new Error('Could not recover the embedded archify source.');
      err.name = 'NoEmbeddedSource';
      throw err;
    }
    return {
      type: extracted.type,
      source: extracted.source,
      version: extracted.version,
      html: String(htmlText),
    };
  }

  // ------------------------------------------------------------------ enumerate
  function enumerate(model) {
    return scanStamps(model.html).map((stamp) => {
      const loc = locate(model, stamp.id, stamp.kind);
      return {
        id: stamp.id,
        kind: stamp.kind,
        parts: stamp.parts,
        collection: loc.collection || null,
        index: typeof loc.index === 'number' ? loc.index : null,
        derived: !!loc.derived,
        label: labelOf(loc, stamp.id),
        source: loc.obj || null,
      };
    });
  }

  function resolveHit(model, hit) {
    if (!hit) return null;
    const id = typeof hit === 'string' ? hit : (hit.id || (hit.arch && hit.arch.id) || hit.archId);
    if (!id) return null;
    const kind = typeof hit === 'object' ? (hit.kind || (hit.arch && hit.arch.kind) || null) : null;
    const list = enumerate(model);
    // Prefer an exact (id, kind) match; fall back to id-only when the hit gave
    // no kind (id-only is ambiguous under collisions — the caller should pass
    // the stamp's data-arch-kind alongside data-arch-id).
    const found = (kind ? list.find((r) => r.id === id && r.kind === kind) : null) || list.find((r) => r.id === id);
    if (found) return found;
    const loc = locate(model, id, kind);
    if (loc.unknown) return null;
    return { id, kind: kind || null, parts: hit.part ? [hit.part] : [], collection: loc.collection || null, index: loc.index ?? null, derived: !!loc.derived, label: labelOf(loc, id), source: loc.obj || null };
  }

  // ------------------------------------------------------------------ contextFor
  function digest(obj) {
    if (!obj) return null;
    const out = {};
    for (const k of ['id', 'label', 'title', 'lane', 'col', 'type', 'from', 'to', 'variant']) {
      if (obj[k] !== undefined) out[k] = obj[k];
    }
    return out;
  }

  function contextFor(model, ref) {
    const { source, type } = model;
    const loc = ref && ref.source ? { obj: ref.source, collection: ref.collection, derived: ref.derived } : locate(model, ref.id, ref.kind);
    const neighbors = [];
    const edgeColl = fields(type).edges;
    const edges = source[edgeColl] || [];

    if (EDGE_KINDS.has(ref.kind) && loc.obj) {
      // an edge: its two endpoints
      const nodeColl = fields(type).nodes;
      const nodes = source[nodeColl] || [];
      for (const end of [loc.obj.from, loc.obj.to]) {
        const n = nodes.find((x) => x && x.id === end);
        if (n) neighbors.push({ rel: 'endpoint', ...digest(n) });
      }
    } else {
      // a node-like element: touching edges + the far endpoints
      for (let i = 0; i < edges.length; i += 1) {
        const e = edges[i];
        if (!e) continue;
        if (e.from === ref.id || e.to === ref.id) {
          neighbors.push({ rel: 'edge', id: `${fields(type).edgePrefix}:${e.from}->${e.to}:${i}`, ...digest(e) });
        }
      }
    }

    return {
      id: ref.id,
      kind: ref.kind,
      diagramType: type,
      element: loc.obj || null,
      neighbors,
      source,               // archify JSON is small — send it whole (plan §4.1)
      budget: BUDGETS[type] || '',
      instruction: null,    // caller fills with the user's sentence
    };
  }

  // ------------------------------------------------------------------ opsSchema
  function idSchema(pin) { return pin ? { const: pin } : { type: 'string', pattern: ID_PAT }; }

  function workflowNodeSchema(pinId) {
    return {
      type: 'object', additionalProperties: false, required: ['id', 'lane', 'col', 'type', 'label'],
      properties: {
        id: idSchema(pinId),
        lane: { type: 'string', pattern: ID_PAT },
        col: { type: 'integer', minimum: 0, maximum: 5 },
        type: { enum: COMPONENT_TYPES },
        label: { type: 'string', minLength: 1 },
        sublabel: { type: 'string' },
        tag: { type: 'string' },
        width: { type: 'number', minimum: 32 },
        height: { type: 'number', minimum: 32 },
        yOffset: { type: 'number' },
      },
    };
  }

  function workflowEdgeSchema(pinFrom, pinTo) {
    return {
      type: 'object', additionalProperties: false, required: ['from', 'to'],
      properties: {
        from: idSchema(pinFrom), to: idSchema(pinTo),
        label: { type: 'string' },
        variant: { enum: VARIANTS },
        role: { enum: ['main', 'branch', 'async', 'return', 'error'] },
        fromSide: { enum: SIDES }, toSide: { enum: SIDES },
        route: { enum: ROUTES },
        via: { type: 'array', items: POINT },
        labelAt: POINT,
        labelDx: { type: 'number' }, labelDy: { type: 'number' },
        labelSegment: { type: 'integer', minimum: 0 },
        channelX: { type: 'number' }, channelY: { type: 'number' },
        bias: { type: 'number', minimum: 0, maximum: 1 },
        width: { type: 'number', minimum: 0.5 },
      },
    };
  }

  // Non-workflow types: keep the object permissive but pin the identity. The
  // real field-level gate is the server-side ajv re-validation on render.
  function genericNodeSchema(pinId) {
    return { type: 'object', required: ['id'], properties: { id: idSchema(pinId) } };
  }
  function genericEdgeSchema(pinFrom, pinTo) {
    return { type: 'object', required: ['from', 'to'], properties: { from: idSchema(pinFrom), to: idSchema(pinTo) } };
  }

  const REJECT_OP = {
    type: 'object', additionalProperties: false, required: ['op', 'reason'],
    properties: { op: { const: 'reject' }, reason: { type: 'string', maxLength: 500 } },
  };

  function opsWrap(items, { maxItems = 3 } = {}) {
    return {
      type: 'object', additionalProperties: false, required: ['ops'],
      properties: { ops: { type: 'array', minItems: 1, maxItems, items: { anyOf: items } } },
    };
  }

  // Per-kind editable CONTENT-field vocabulary for select/edit. This MUST mirror
  // the 편집 form (editor.js `archFormSpec`) key-for-key per kind, so the select-mode
  // set_fields schema and the manual edit form allow EXACTLY the same fields and
  // the same field-lock applies. Field VALUES are re-validated server-side (ajv)
  // on the next render — like the stage-5 layout/polish set_fields — so the key
  // SET is the generation-time lock and the value grammar is the server's job.
  const NODE_CONTENT = ['label', 'sublabel', 'type', 'tag', 'lane', 'col'];
  const EDGE_CONTENT = ['label', 'variant', 'route', 'fromSide', 'toSide'];
  const CONTENT_FIELDS = {
    node: NODE_CONTENT, component: NODE_CONTENT, participant: NODE_CONTENT, state: NODE_CONTENT, stage: NODE_CONTENT,
    edge: EDGE_CONTENT, connection: EDGE_CONTENT, flow: EDGE_CONTENT, transition: EDGE_CONTENT, message: EDGE_CONTENT,
    lane: ['label', 'variant'],
    phase: ['label', 'variant', 'fromCol', 'toCol'],
    group: ['label', 'variant', 'fromCol', 'toCol'],
    'meta-title': ['title'], 'meta-subtitle': ['subtitle'],
  };
  function contentFieldsFor(kind) { return CONTENT_FIELDS[kind] || ['label']; }

  // The const-pinned id for a selected ref. meta rides its meta:title/meta:subtitle
  // id; every other kind rides its own id (edges: the derived id, which encodes
  // from/to, so pinning it pins the endpoints). Used by BOTH the schema pin and the
  // apply scope-gate so they can never disagree.
  function selectPinId(ref) {
    if (!ref) return null;
    if (META_KINDS.has(ref.kind)) return ref.kind === 'meta-title' ? 'meta:title' : 'meta:subtitle';
    return ref.id;
  }

  // Select-mode set_fields tool schema: op is set_fields (only the changed fields),
  // id const-pinned (scope guarantee — an out-of-scope target is unrepresentable),
  // and `fields` key-restricted to the kind's CONTENT vocab with
  // additionalProperties:false, so a cross-scope field is unrepresentable at
  // generation time. Same op shape 편집/layout/polish use, so the one set_fields
  // apply + field-lock + single-element bleed-diff carry it unchanged.
  function buildSelectFieldSchema(pinId, fieldKeys) {
    const props = {};
    for (const k of fieldKeys) props[k] = {}; // any value; server ajv re-validates the merged object
    return opsWrap([
      { type: 'object', additionalProperties: false, required: ['op', 'id', 'fields'],
        properties: {
          op: { const: 'set_fields' }, id: { const: pinId }, kind: { type: 'string' },
          fields: { type: 'object', additionalProperties: false, minProperties: 1, properties: props },
        } },
      REJECT_OP,
    ], { maxItems: 2 });
  }

  // Returns the tool input_schema (like DomObjectAdapter.buildToolSchema). In
  // 'select' mode the target id is const-pinned so a scope violation is
  // unrepresentable; the emitted op is the lightweight set_fields (only the
  // changed CONTENT fields) — the model no longer regenerates the whole object.
  function opsSchema(mode, ref) {
    if ((mode === 'select' || mode == null) && ref) {
      // SELECT now emits set_fields (only the changed fields), identity const-pinned,
      // fields key-locked to the kind's CONTENT vocab. meta rides meta:title/subtitle;
      // edges ride the derived id (from/to pinned by construction). REJECT stays for
      // out-of-scope requests. Same op the 편집/레이아웃/다듬기 modes already use.
      return buildSelectFieldSchema(selectPinId(ref), contentFieldsFor(ref.kind));
    }

    // Broad modes (draw / layout / polish): the full op vocabulary, unpinned.
    return opsWrap([
      { type: 'object', additionalProperties: false, required: ['op', 'id', 'node'], properties: { op: { const: 'replace_node' }, id: { type: 'string', pattern: ID_PAT }, node: { type: 'object' } } },
      { type: 'object', additionalProperties: false, required: ['op', 'id', 'edge'], properties: { op: { const: 'replace_edge' }, id: { type: 'string' }, edge: { type: 'object' } } },
      { type: 'object', additionalProperties: false, required: ['op', 'meta'], properties: { op: { const: 'update_meta' }, meta: { type: 'object' } } },
      { type: 'object', additionalProperties: false, required: ['op', 'node'], properties: { op: { const: 'add_node' }, node: { type: 'object' } } },
      { type: 'object', additionalProperties: false, required: ['op', 'edge'], properties: { op: { const: 'add_edge' }, edge: { type: 'object' } } },
      { type: 'object', additionalProperties: false, required: ['op', 'id'], properties: { op: { const: 'remove_node' }, id: { type: 'string', pattern: ID_PAT } } },
      { type: 'object', additionalProperties: false, required: ['op', 'id'], properties: { op: { const: 'remove_edge' }, id: { type: 'string' } } },
      REJECT_OP,
    ], { maxItems: 8 });
  }

  // ------------------------------------------------------------------ apply
  function scopeError(msg) { const e = new Error(msg); e.name = 'ScopeViolation'; return e; }

  // Mechanical scope gate + shape normalisation (plan D3 layer 2). In select
  // mode any op whose target id differs from selectedId throws ScopeViolation.
  function sanitizeOps(raw, ref, mode = 'select') {
    if (!raw || !Array.isArray(raw.ops) || raw.ops.length === 0) throw new Error('response has no ops array.');
    const selectedId = ref && ref.id;
    const select = mode === 'select' || mode == null;
    const ops = [];
    const notes = [];
    let reject = null;
    for (const op of raw.ops) {
      if (!op || typeof op !== 'object') continue;
      if (op.op === 'reject') { reject = { op: 'reject', reason: String(op.reason || 'no reason').slice(0, 500) }; continue; }
      if (select) {
        // SELECT emits set_fields (only the changed fields). Scope gate: the target
        // id must equal the selected element's pinned id (ScopeViolation otherwise);
        // fields are field-locked to the kind's CONTENT vocab (out-of-vocab keys are
        // stripped, like the stage-5 layout/polish field-lock). The single-element
        // guarantee holds and a rename is unrepresentable (set_fields has no nested id).
        if (op.op === 'set_fields') {
          const pin = selectPinId(ref);
          if (op.id !== pin) throw scopeError(`op targets ${op.id} outside the selected element ${pin}`);
          const allowed = new Set(contentFieldsFor(ref && ref.kind));
          const flds = {};
          for (const [k, v] of Object.entries(op.fields || {})) {
            if (!allowed.has(k)) { notes.push(`field-lock: key "${k}" removed (select allows ${[...allowed].join('/')} for ${ref && ref.kind})`); continue; }
            flds[k] = v;
          }
          if (Object.keys(flds).length) ops.push({ op: 'set_fields', id: pin, kind: op.kind || (ref && ref.kind) || null, fields: flds });
          else notes.push(`set_fields for "${op.id}": no allowed fields — dropped`);
        } else {
          throw scopeError(`op "${op.op}" is not allowed in select mode for ${selectedId}`);
        }
      } else if (mode === 'edit') {
        // manual single-element edit (편집) — set_fields / update_meta pinned to
        // the selected id (the form only produces valid fields, but the scope
        // gate still forbids touching any other element).
        if (op.op === 'set_fields') {
          if (op.id !== selectedId) throw scopeError(`op targets ${op.id} outside the selected element ${selectedId}`);
          ops.push({ op: 'set_fields', id: selectedId, kind: op.kind || (ref && ref.kind) || null, fields: op.fields || {} });
        } else if (op.op === 'update_meta') {
          const allowed = ref.kind === 'meta-title' ? 'title' : ref.kind === 'meta-subtitle' ? 'subtitle' : null;
          const meta = {};
          for (const [k, v] of Object.entries(op.meta || {})) {
            if (allowed && k !== allowed) throw scopeError(`update_meta may only change ${allowed} for the selected element`);
            meta[k] = v;
          }
          ops.push({ op: 'update_meta', meta });
        } else {
          throw scopeError(`op "${op.op}" is not allowed in edit mode for ${selectedId}`);
        }
      } else {
        ops.push(op); // broad modes (draw/all): trusted to the schema + server-side ajv
      }
    }
    return { ops, reject, notes };
  }

  function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

  // Locate the array slot to mutate. When the ref names a collection, search
  // only there (id is unique within it) so an id shared across collections is
  // never mis-targeted; otherwise fall back to a global first-match scan.
  function targetSlot(source, id, ref) {
    if (ref && ref.collection && Array.isArray(source[ref.collection])) {
      const index = source[ref.collection].findIndex((o) => o && o.id === id);
      if (index >= 0) return { collection: ref.collection, index };
    }
    const hit = findById(source, id);
    return hit ? { collection: hit.collection, index: hit.index } : null;
  }

  // Applies sanitized ops to a DEEP COPY of the source (the caller's model is
  // never mutated, so undo is a real byte-for-byte restore). Returns the new
  // model (source updated, html left as the pre-edit view until render()).
  function apply(model, rawOps, opts = {}) {
    const ref = opts.ref || (opts.selectedId ? { id: opts.selectedId, kind: opts.selectedKind } : null);
    const mode = opts.mode || (ref ? 'select' : 'all');
    const { ops, reject } = sanitizeOps(rawOps, ref, mode);
    if (reject && ops.length === 0) {
      return { model, changedIds: [], rejected: reject };
    }
    const type = model.type;
    const F = fields(type);
    const source = clone(model.source);
    const changedIds = new Set();

    for (const op of ops) {
      if (op.op === 'replace_node') {
        const slot = targetSlot(source, op.id, ref);
        if (!slot) throw new Error(`replace_node: id "${op.id}" not found in source`);
        source[slot.collection][slot.index] = op.node;
        changedIds.add(op.id);
      } else if (op.op === 'replace_edge') {
        const parsed = parseDerivedEdgeId(op.id);
        if (!parsed) throw new Error(`replace_edge: unrecognised edge id "${op.id}"`);
        const arr = source[F.edges] || [];
        let index = parsed.index;
        if (!arr[index] || arr[index].from !== parsed.from || arr[index].to !== parsed.to) {
          index = arr.findIndex((e) => e && e.from === parsed.from && e.to === parsed.to);
        }
        if (index < 0) throw new Error(`replace_edge: edge "${op.id}" not found in source`);
        arr[index] = op.edge;
        changedIds.add(op.id);
      } else if (op.op === 'update_meta') {
        source.meta = source.meta || {};
        for (const [k, v] of Object.entries(op.meta)) {
          source.meta[k] = v;
          changedIds.add(k === 'title' ? 'meta:title' : k === 'subtitle' ? 'meta:subtitle' : `meta:${k}`);
        }
      } else if (op.op === 'add_node') {
        source[F.nodes] = source[F.nodes] || [];
        source[F.nodes].push(op.node);
        if (op.node && op.node.id) changedIds.add(op.node.id);
      } else if (op.op === 'add_edge') {
        source[F.edges] = source[F.edges] || [];
        source[F.edges].push(op.edge);
        if (op.edge) changedIds.add(`${F.edgePrefix}:${op.edge.from}->${op.edge.to}:${source[F.edges].length - 1}`);
      } else if (op.op === 'remove_node') {
        const slot = targetSlot(source, op.id, ref);
        if (slot) { source[slot.collection].splice(slot.index, 1); changedIds.add(op.id); }
      } else if (op.op === 'remove_edge') {
        const parsed = parseDerivedEdgeId(op.id);
        const arr = source[F.edges] || [];
        let index = parsed ? parsed.index : -1;
        if (parsed && (!arr[index] || arr[index].from !== parsed.from || arr[index].to !== parsed.to)) {
          index = arr.findIndex((e) => e && e.from === parsed.from && e.to === parsed.to);
        }
        if (index >= 0) { arr.splice(index, 1); changedIds.add(op.id); }
      } else if (op.op === 'set_fields') {
        for (const id of applySetFields(source, op, type)) changedIds.add(id);
      } else {
        throw new Error(`apply: unknown op "${op.op}"`);
      }
    }

    return { model: { ...model, source }, changedIds: [...changedIds], rejected: reject };
  }

  // ------------------------------------------------------------------ render
  async function post(f, url, body) {
    const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}: ${data.error || text.slice(0, 200)}`);
    return data;
  }

  // Re-render the model's source via `archify serve` POST /render. Returns the
  // fresh stamped HTML (source re-embedded). Does not mutate the model.
  async function render(model, opts = {}) {
    const { baseUrl, fetch: f } = endpoint(opts);
    const data = await post(f, baseUrl + '/render', { type: model.type, source: model.source });
    if (typeof data.html !== 'string') throw new Error('render: server returned no html');
    return data.html;
  }

  // ------------------------------------------------------------------ bleedDiff
  function clusterMap(html) {
    const re = /<g data-arch-id="([^"]*)" data-arch-kind="([^"]*)" data-arch-part="([^"]*)">[\s\S]*?<\/g>/g;
    const map = new Map();
    let m;
    while ((m = re.exec(html)) !== null) {
      const id = decodeAttr(m[1]);
      const kind = decodeAttr(m[2]);
      const part = decodeAttr(m[3]);
      // Key on (id, kind, part) so a colliding lane/node id stays distinct.
      map.set(id + " " + kind + " " + part, { id, kind, part, block: m[0] });
    }
    return map;
  }

  // Replace whitelisted / expected-to-change regions with stable tokens so a
  // residue comparison isolates *unexpected* changes (plan §4.3). Masks: every
  // cluster of the selected element (all kinds that share its collection — e.g.
  // a participant + its lifeline — plus, for meta, its <h1>/<p>), each whitelisted
  // <g> cluster (legend), the embedded source, and the viewBox (auto-height).
  function maskDocument(html, selId, selKinds, whitelist) {
    let out = html;
    const sel = regexEscape(selId);
    if (selKinds && selKinds.size) {
      for (const k of selKinds) {
        out = out.replace(new RegExp("<g data-arch-id=\"" + sel + "\" data-arch-kind=\"" + regexEscape(k) + "\"[\\s\\S]*?</g>", "g"), "\u27E6SEL\u27E7");
      }
    } else {
      out = out.replace(new RegExp("<g data-arch-id=\"" + sel + "\"[\\s\\S]*?</g>", "g"), "\u27E6SEL\u27E7");
    }
    out = out.replace(new RegExp("<(h1|p)([^>]*)data-arch-id=\"" + sel + "\"([\\s\\S]*?)</\\1>", "g"), "\u27E6SEL\u27E7");
    for (const w of whitelist) {
      const we = regexEscape(w);
      out = out.replace(new RegExp("<g data-arch-id=\"" + we + "\"[\\s\\S]*?</g>", "g"), "\u27E6WL:" + w + "\u27E7");
    }
    out = out.replace(/(<script[^>]*id="archify-source"[^>]*>)[\s\S]*?(<\/script>)/, "$1\u27E6SRC\u27E7$2");
    out = out.replace(/viewBox="0 0 [\d.]+ [\d.]+"/g, 'viewBox="\u27E6VB\u27E7"');
    // The root <svg aria-label> echoes meta.title + meta.subtitle, so a meta edit
    // legitimately changes it (like viewBox/legend). Node/edge changes never touch
    // it, and their <g> blocks are still caught by clusterMap \u2014 so masking is safe.
    out = out.replace(/(<svg[^>]*aria-label=")[^"]*(")/g, "$1\u27E6AL\u27E7$2");
    return out;
  }

  // The set of stamp kinds that back the SAME source object as the selected
  // element (all kinds mapping to its collection). Distinguishes workflow
  // "trace" (lane obj ≠ node obj -> {lane} vs {node}) from a sequence
  // participant (participant + lifeline share one object -> {participant,lifeline}).
  function selectedKindSet(type, selKind, selCollection) {
    const map = KIND_COLLECTION[type];
    const coll = selCollection || (map && selKind ? map[selKind] : null);
    if (map && coll) {
      const kinds = Object.entries(map).filter(([, c]) => c === coll).map(([k]) => k);
      if (kinds.length) return new Set(kinds);
    }
    return selKind ? new Set([selKind]) : null;
  }

  // Proves only the selected element's data-arch-id cluster(s) changed between
  // beforeHtml and afterHtml. `selected` is the selected id (string) or a
  // { id, kind, collection } ref. The diagram type is inferred from the embedded
  // source (or opts.type). Whitelists legend + embedded source + viewBox/
  // auto-height. offenders empty == clean edit.
  function bleedDiff(beforeHtml, afterHtml, selected, opts = {}) {
    const whitelist = new Set(opts.whitelistIds || ['legend']);
    const selId = typeof selected === 'string' ? selected : (selected && selected.id);
    const selKind = typeof selected === 'object' && selected ? (selected.kind || opts.selectedKind || null) : (opts.selectedKind || null);
    const selCollection = typeof selected === 'object' && selected ? (selected.collection || null) : null;
    const type = opts.type || (beforeHtml.match(/data-archify-type="([^"]*)"/) || [])[1] || null;
    const selKinds = selectedKindSet(type, selKind, selCollection);
    const offenders = [];
    const before = clusterMap(beforeHtml);
    const after = clusterMap(afterHtml);
    const keys = new Set([...before.keys(), ...after.keys()]);
    for (const key of keys) {
      const info = before.get(key) || after.get(key);
      if (whitelist.has(info.id)) continue;
      const isSelected = info.id === selId && (selKinds ? selKinds.has(info.kind) : true);
      if (isSelected) continue; // the selected element may change
      const b = before.get(key);
      const a = after.get(key);
      if (!b || !a || b.block !== a.block) offenders.push(info.id + ":" + info.kind + ":" + info.part);
    }
    if (maskDocument(beforeHtml, selId, selKinds, whitelist) !== maskDocument(afterHtml, selId, selKinds, whitelist)) {
      offenders.push('document-residue (change outside the selected cluster / whitelist)');
    }
    return { ok: offenders.length === 0, offenders: [...new Set(offenders)] };
  }

  // ------------------------------------------------------------------ verify
  // POST /validate (ajv + renderer layout, with fix suggestions) + POST /check
  // + bleedDiff. Returns a rich result; result.ok is the go/no-go. `html` is the
  // freshly rendered candidate; the "before" is opts.beforeHtml || model.html.
  async function verify(model, html, opts = {}) {
    const { baseUrl, fetch: f } = endpoint(opts);
    const selectedId = opts.selectedId || (opts.ref && opts.ref.id);
    const selectedKind = opts.selectedKind || (opts.ref && opts.ref.kind) || null;
    const selectedCollection = (opts.ref && opts.ref.collection) || opts.selectedCollection || null;
    const beforeHtml = opts.beforeHtml != null ? opts.beforeHtml : model.html;
    const whitelistIds = opts.whitelistIds || ['legend'];

    const [validate, check] = await Promise.all([
      post(f, baseUrl + '/validate', { type: model.type, source: model.source }),
      post(f, baseUrl + '/check', { html }),
    ]);
    // 그리기 passes addedIds (new clusters); whole-diagram modes pass an allowedIds
    // SET; select/edit pass a single id.
    let bleed;
    if (Array.isArray(opts.addedIds)) {
      bleed = addDiffSet(beforeHtml, html, opts.addedIds, { whitelistIds });
    } else if (Array.isArray(opts.allowedIds)) {
      bleed = bleedDiffSet(beforeHtml, html, opts.allowedIds, { whitelistIds });
    } else if (selectedId) {
      bleed = bleedDiff(beforeHtml, html, { id: selectedId, kind: selectedKind, collection: selectedCollection }, { whitelistIds, type: model.type });
    } else {
      bleed = { ok: true, offenders: [] };
    }

    const findings = [];
    if (!validate.ok) for (const e of validate.errors || []) findings.push({ level: 'error', source: 'validate', message: e });
    if (!check.ok) for (const c of (check.checks || []).filter((x) => !x.ok)) findings.push({ level: 'error', source: 'check', message: `${c.name}: ${(c.details || []).join('; ') || 'failed'}` });
    if (!bleed.ok) for (const o of bleed.offenders) findings.push({ level: 'error', source: 'bleed', message: `unexpected change in ${o}` });

    return { ok: findings.length === 0, findings, validate, check, bleed };
  }

  // ------------------------------------------------------------------ serialize
  // Current rendered HTML (source stays embedded — render already re-embedded
  // it). Downloads are clean by construction: no editor agent / overlay is ever
  // written into the rendered file.
  function serialize(model) { return model.html; }

  // Convenience: commit a verified render into the model's view.
  function commit(model, html) { return { ...model, html }; }

  // ================================================================= stage 5
  // class-a full mode parity: manual edit (set_fields), draw (add_node/add_edge),
  // native structural validation (검증④), and the two whole-diagram field-locked
  // modes (레이아웃=geometry-only, 다듬기=text-only). Every path re-renders through
  // serve and is held by the SAME three-layer guarantee, generalised from a single
  // selected id to a SET of allowed ids (schema field-lock -> apply field gate ->
  // multi-id bleed-diff). The select-mode single-element guarantee is untouched.

  // Field-class vocabularies (plan §5): LAYOUT = geometry/routing, TEXT = copy.
  // meta.title/subtitle ride the TEXT class via the meta:* ids.
  const LAYOUT_FIELDS = ['col', 'lane', 'width', 'height', 'route', 'via', 'fromSide', 'toSide', 'labelDx', 'labelDy', 'labelAt', 'bias', 'yOffset', 'channelX', 'channelY', 'labelSegment', 'fromCol', 'toCol'];
  const TEXT_FIELDS = ['label', 'sublabel', 'tag', 'title', 'subtitle'];
  const LAYOUT_FIELD_SET = new Set(LAYOUT_FIELDS);
  const TEXT_FIELD_SET = new Set(TEXT_FIELDS);
  const NODE_KINDS = new Set(['node', 'component', 'participant', 'state', 'stage']);
  function isNodeKind(kind) { return NODE_KINDS.has(kind); }

  // Resolve the array slot for an id, preferring the collection its kind names
  // (id is unique within a collection but may collide across them).
  function slotFor(source, type, id, kind) {
    const kc = kind && KIND_COLLECTION[type] && KIND_COLLECTION[type][kind];
    if (kc && Array.isArray(source[kc])) {
      const index = source[kc].findIndex((o) => o && o.id === id);
      if (index >= 0) return { collection: kc, index };
    }
    const hit = findById(source, id);
    return hit ? { collection: hit.collection, index: hit.index } : null;
  }

  // Merge fields into a target object; '', null, undefined delete the key (so a
  // cleared form field removes an optional property rather than writing an empty).
  function mergeFields(target, flds) {
    for (const [k, v] of Object.entries(flds || {})) {
      if (v === null || v === undefined || v === '') delete target[k];
      else target[k] = v;
    }
  }

  // Merge op.fields into the object addressed by op.id (node/edge/meta/card).
  // Returns the changed id(s); an edge endpoint change also yields the new
  // derived id (both are then allowed by the bleed so the re-route is legitimate).
  function applySetFields(source, op, type) {
    const F = fields(type);
    const id = op.id;
    if (id === 'meta:title' || id === 'meta:subtitle' || id === 'meta') {
      source.meta = source.meta || {};
      const f = { ...op.fields };
      if (f.label != null && id === 'meta:title') { f.title = f.label; delete f.label; }
      if (f.label != null && id === 'meta:subtitle') { f.subtitle = f.label; delete f.label; }
      mergeFields(source.meta, f);
      return [id];
    }
    const edge = parseDerivedEdgeId(id);
    if (edge) {
      const arr = source[F.edges] || [];
      let index = edge.index;
      if (!arr[index] || arr[index].from !== edge.from || arr[index].to !== edge.to) {
        index = arr.findIndex((e) => e && e.from === edge.from && e.to === edge.to);
      }
      if (index < 0) throw new Error(`set_fields: edge "${id}" not found in source`);
      mergeFields(arr[index], op.fields);
      const newId = `${F.edgePrefix}:${arr[index].from}->${arr[index].to}:${index}`;
      return newId !== id ? [id, newId] : [id];
    }
    const idxMatch = /^([a-z]+):(\d+)$/.exec(id);
    if (idxMatch && INDEX_PREFIX[idxMatch[1]]) {
      const coll = INDEX_PREFIX[idxMatch[1]];
      const index = Number(idxMatch[2]);
      if (!source[coll] || !source[coll][index]) throw new Error(`set_fields: "${id}" not found in source`);
      mergeFields(source[coll][index], op.fields);
      return [id];
    }
    const slot = slotFor(source, type, id, op.kind);
    if (!slot) throw new Error(`set_fields: id "${id}" not found in source`);
    mergeFields(source[slot.collection][slot.index], op.fields);
    return [id];
  }

  // Field-locked mechanical sanitize (plan §5 field-class lock) — the SET-axis
  // analogue of dom-adapter's sanitizeLayoutOps/sanitizePolishOps. Any non-set_fields
  // op and any out-of-vocabulary field key is stripped even if it slipped the schema.
  function sanitizeFieldOps(raw, fieldSet, allowedIds, label) {
    if (!raw || !Array.isArray(raw.ops)) throw new Error(`${label} response has no ops array.`);
    const allow = allowedIds ? new Set(allowedIds) : null;
    const ops = [], notes = [];
    let reject = null;
    for (const op of raw.ops) {
      if (!op || typeof op !== 'object') { notes.push('non-object op skipped'); continue; }
      if (op.op === 'reject') { reject = { reason: String(op.reason || 'no reason').slice(0, 500) }; continue; }
      if (op.op !== 'set_fields') { notes.push(`field-lock: "${String(op.op).slice(0, 20)}" is not allowed in ${label} mode (set_fields only)`); continue; }
      if (allow && !allow.has(op.id)) { notes.push(`out-of-scope id "${op.id}" ignored`); continue; }
      const flds = {};
      for (const [k, v] of Object.entries(op.fields || {})) {
        if (!fieldSet.has(k)) { notes.push(`field-lock: key "${k}" removed (${label} allows ${[...fieldSet].join('/')})`); continue; }
        flds[k] = v;
      }
      if (Object.keys(flds).length) ops.push({ op: 'set_fields', id: op.id, kind: op.kind || null, fields: flds });
      else notes.push(`set_fields for "${op.id}": no allowed ${label} fields — dropped`);
    }
    return { ops, reject, notes };
  }
  function sanitizeLayoutOps(raw, allowedIds) { return sanitizeFieldOps(raw, LAYOUT_FIELD_SET, allowedIds, 'layout'); }
  function sanitizePolishOps(raw, allowedIds) { return sanitizeFieldOps(raw, TEXT_FIELD_SET, allowedIds, 'polish'); }

  // The derived ids of edges touching any of the given node ids.
  function incidentEdgeIds(model, nodeIds) {
    const set = new Set(nodeIds);
    const F = fields(model.type);
    const edges = model.source[F.edges] || [];
    const out = [];
    edges.forEach((e, i) => { if (e && (set.has(e.from) || set.has(e.to))) out.push(`${F.edgePrefix}:${e.from}->${e.to}:${i}`); });
    return out;
  }
  // Widen a changed-id set to include edges incident to any changed node — moving
  // or resizing a node legitimately reroutes its own edges (plan R4). Text-only
  // changes leave edges byte-identical, so this widening never hides a real bleed.
  function expandAllowed(model, changedIds) {
    const F = fields(model.type);
    const nodeIds = new Set((model.source[F.nodes] || []).map((n) => n && n.id).filter(Boolean));
    const changedNodes = changedIds.filter((id) => nodeIds.has(id));
    return [...new Set([...changedIds, ...incidentEdgeIds(model, changedNodes)])];
  }

  // Multi-id bleed: mask every allowed id's cluster(s) + <h1>/<p> meta, the
  // whitelist, the embedded source, and the viewBox, then prove the residue is
  // byte-identical (plan §4.3 generalised to a set).
  function maskAll(html, allowedIds, whitelist) {
    let out = html;
    for (const id of allowedIds) {
      const sel = regexEscape(id);
      out = out.replace(new RegExp('<g data-arch-id="' + sel + '" data-arch-kind="[^"]*"[\\s\\S]*?</g>', 'g'), '⟦SEL⟧');
      out = out.replace(new RegExp('<(h1|p)([^>]*)data-arch-id="' + sel + '"([\\s\\S]*?)</\\1>', 'g'), '⟦SEL⟧');
    }
    for (const w of whitelist) {
      out = out.replace(new RegExp('<g data-arch-id="' + regexEscape(w) + '"[\\s\\S]*?</g>', 'g'), '⟦WL:' + w + '⟧');
    }
    out = out.replace(/(<script[^>]*id="archify-source"[^>]*>)[\s\S]*?(<\/script>)/, '$1⟦SRC⟧$2');
    out = out.replace(/viewBox="0 0 [\d.]+ [\d.]+"/g, 'viewBox="⟦VB⟧"');
    // root <svg aria-label> echoes meta.title+subtitle — meta edits change it legitimately.
    out = out.replace(/(<svg[^>]*aria-label=")[^"]*(")/g, '$1⟦AL⟧$2');
    return out;
  }
  function bleedDiffSet(beforeHtml, afterHtml, allowedIds, opts = {}) {
    const whitelist = new Set(opts.whitelistIds || ['legend']);
    const allow = new Set(allowedIds || []);
    const offenders = [];
    const before = clusterMap(beforeHtml), after = clusterMap(afterHtml);
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const info = before.get(key) || after.get(key);
      if (whitelist.has(info.id) || allow.has(info.id)) continue;
      const b = before.get(key), a = after.get(key);
      if (!b || !a || b.block !== a.block) offenders.push(info.id + ':' + info.kind + ':' + info.part);
    }
    if (maskAll(beforeHtml, [...allow], whitelist) !== maskAll(afterHtml, [...allow], whitelist)) {
      offenders.push('document-residue (change outside allowed ids / whitelist)');
    }
    return { ok: offenders.length === 0, offenders: [...new Set(offenders)] };
  }

  // Add-diff for 그리기: a fresh add_node/add_edge inserts a NEW cluster that has no
  // "before" counterpart, so a residue compare (bleedDiffSet) would always trip.
  // Instead assert: every pre-existing cluster is byte-identical, and every cluster
  // that appears is one of newIds (the class-a analogue of dom-adapter.addDiff).
  function addDiffSet(beforeHtml, afterHtml, newIds, opts = {}) {
    const whitelist = new Set(opts.whitelistIds || ['legend']);
    const news = new Set(newIds);
    const before = clusterMap(beforeHtml), after = clusterMap(afterHtml);
    const offenders = [];
    for (const [key, b] of before) {
      if (whitelist.has(b.id)) continue;
      const a = after.get(key);
      if (!a) { offenders.push('removed ' + b.id + ':' + b.kind + ':' + b.part); continue; }
      if (a.block !== b.block) offenders.push('changed ' + b.id + ':' + b.kind + ':' + b.part);
    }
    for (const [key, a] of after) {
      if (before.has(key) || whitelist.has(a.id)) continue;
      if (!news.has(a.id)) offenders.push('unexpected new ' + a.id + ':' + a.kind + ':' + a.part);
    }
    const appeared = new Set([...after.values()].map((c) => c.id));
    for (const id of news) if (!appeared.has(id)) offenders.push('new id did not appear: ' + id);
    return { ok: offenders.length === 0, offenders: [...new Set(offenders)] };
  }

  // 검증④ — the renderer's OWN layout validator (overlap / label-collision /
  // edge-crossing / legend-clearance), richer than a DOM bbox heuristic. Every
  // problem line names its offending ids in quotes; we pin them to data-arch-ids.
  function parseLayoutErrors(model, errors) {
    const F = fields(model.type);
    const nodes = model.source[F.nodes] || [];
    const edges = model.source[F.edges] || [];
    const nodeIds = new Set(nodes.map((n) => n && n.id).filter(Boolean));
    const edgeId = (from, to) => { const i = edges.findIndex((e) => e && e.from === from && e.to === to); return i >= 0 ? `${F.edgePrefix}:${from}->${to}:${i}` : null; };
    const findings = [];
    for (const raw of errors) {
      const err = String(raw || '').trim();
      if (!err) continue;
      const firstLine = err.split('\n')[0].trim();
      if (/validation failed:?$/i.test(firstLine) || /schema validation failed/i.test(firstLine)) {
        findings.push({ arch_id: null, kind: 'structure', issue: firstLine, suggestion: '' });
        continue;
      }
      const quoted = [...firstLine.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
      const edgeM = firstLine.match(/Edge "([^"]+)"\s*->\s*"([^"]+)"/);
      let arch_id = null;
      if (edgeM) arch_id = edgeId(edgeM[1], edgeM[2]);
      if (!arch_id) { const nid = quoted.find((q) => nodeIds.has(q)); if (nid) arch_id = nid; }
      const dash = firstLine.indexOf('—'); // em dash separates problem from fix suggestion
      findings.push({
        arch_id, kind: 'structure',
        issue: dash >= 0 ? firstLine.slice(0, dash).trim() : firstLine,
        suggestion: dash >= 0 ? firstLine.slice(dash + 1).trim() : '',
      });
    }
    return findings;
  }
  async function nativeValidate(model, opts = {}) {
    const { baseUrl, fetch: f } = endpoint(opts);
    const out = await post(f, baseUrl + '/validate', { type: model.type, source: model.source });
    if (out.ok) return { ok: true, findings: [], errors: [] };
    return { ok: false, findings: parseLayoutErrors(model, out.errors || []), errors: out.errors || [] };
  }

  // Text inventory for 콘텐츠 검증 ①②③⑤ and 다듬기 — each editable copy string
  // pinned to its data-arch-id.
  function textInventory(model) {
    const F = fields(model.type);
    const out = [];
    const meta = model.source.meta || {};
    if (meta.title) out.push({ arch_id: 'meta:title', kind: 'meta-title', text: meta.title, label: meta.title });
    if (meta.subtitle) out.push({ arch_id: 'meta:subtitle', kind: 'meta-subtitle', text: meta.subtitle, label: meta.subtitle });
    for (const n of model.source[F.nodes] || []) {
      if (!n || !n.id) continue;
      out.push({ arch_id: n.id, kind: F.nodeKind, text: [n.label, n.sublabel, n.tag].filter(Boolean).join(' · '), label: n.label || '' });
    }
    (model.source[F.edges] || []).forEach((e, i) => {
      if (e && e.label) out.push({ arch_id: `${F.edgePrefix}:${e.from}->${e.to}:${i}`, kind: F.edgeKind, text: e.label, label: e.label });
    });
    return out;
  }
  // Geometry inventory for 레이아웃.
  function layoutInventory(model) {
    const F = fields(model.type);
    const nodes = (model.source[F.nodes] || []).filter((n) => n && n.id)
      .map((n) => ({ id: n.id, kind: F.nodeKind, lane: n.lane, col: n.col, width: n.width || null, height: n.height || null }));
    const edges = (model.source[F.edges] || []).map((e, i) => ({ id: `${F.edgePrefix}:${e.from}->${e.to}:${i}`, kind: F.edgeKind, from: e.from, to: e.to, route: e.route || 'auto', fromSide: e.fromSide || null, toSide: e.toSide || null }));
    return { nodes, edges };
  }

  // Audit findings tool schema (arch_id pinned to an enum of real ids).
  function buildAuditSchema(archIds) {
    return {
      type: 'object', additionalProperties: false, required: ['findings'],
      properties: { findings: { type: 'array', maxItems: 24, items: {
        type: 'object', additionalProperties: false, required: ['arch_id', 'issue', 'suggestion'],
        properties: { arch_id: { enum: archIds }, issue: { type: 'string', maxLength: 500 }, suggestion: { type: 'string', maxLength: 500 } },
      } } },
    };
  }
  // Whole-diagram field-locked tool schema: set_fields.fields is key-restricted to
  // the mode's field class (additionalProperties:false), so a cross-class field is
  // unrepresentable at generation time (plan §5). id pinned to an enum.
  function buildFieldToolSchema(ids, fieldKeys, maxItems) {
    const props = {};
    for (const k of fieldKeys) props[k] = {}; // any value; server ajv re-validates the merged object
    return {
      type: 'object', additionalProperties: false, required: ['ops'],
      properties: { ops: { type: 'array', minItems: 1, maxItems: maxItems || 60, items: { anyOf: [
        { type: 'object', additionalProperties: false, required: ['op', 'id', 'fields'],
          properties: { op: { const: 'set_fields' }, id: { enum: ids }, kind: { type: 'string' },
            fields: { type: 'object', additionalProperties: false, minProperties: 1, properties: props } } },
        REJECT_OP,
      ] } } },
    };
  }
  function buildLayoutSchema(ids) { return buildFieldToolSchema(ids, LAYOUT_FIELDS, 60); }
  function buildPolishSchema(ids) { return buildFieldToolSchema(ids, TEXT_FIELDS, 60); }

  const api = {
    // plan §3.4 unified interface
    load, enumerate, resolveHit, contextFor, opsSchema, apply, render, verify, serialize,
    // helpers / DomObjectAdapter-parity aliases (swappable surface)
    commit, bleedDiff, sanitizeOps, hasEmbeddedSource, extractSource, setEndpoint,
    buildToolSchema: (ref) => opsSchema('select', ref),   // dom-adapter parity
    serializeClean: serialize,
    TYPE_FIELDS, BUDGETS,
    // stage 5 — full class-a mode parity
    isNodeKind, sanitizeLayoutOps, sanitizePolishOps, bleedDiffSet, addDiffSet, maskAll,
    incidentEdgeIds, expandAllowed, nativeValidate, parseLayoutErrors,
    textInventory, layoutInventory, buildAuditSchema, buildLayoutSchema, buildPolishSchema,
    LAYOUT_FIELDS, TEXT_FIELDS, applySetFields,
    // select/edit CONTENT-field vocabulary (mirrors editor.js archFormSpec) + the
    // select-mode set_fields schema builder + the shared scope-pin resolver.
    CONTENT_FIELDS, contentFieldsFor, selectPinId, buildSelectFieldSchema,
    // schema enums for the manual-edit form dropdowns (single source of truth)
    ENUMS: { componentType: COMPONENT_TYPES, variant: VARIANTS, side: SIDES, route: ROUTES },
  };
  if (typeof globalThis !== 'undefined') globalThis.ArchifyJsonAdapter = api;
  return api;
})();
