// Skill Map drawing. One circle of skills, grouped by folder, with a line for each link.
// The web page, the README image and every exported image come from render(), so they always match.
(function (root) {
  'use strict';
  const SM = root.SkillMap || (root.SkillMap = {});
  const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,system-ui,sans-serif";
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r1 = (v) => Math.round(v * 10) / 10;
  SM.esc = esc;

  // Dark is the page's own look. Light suits slides, docs and white pages.
  const THEMES = {
    dark: { bg: '#08090a', t1: '#f7f8f8', t2: '#a4a8b0', t3: '#80858e', dim: '#45484d', line: 'rgba(255,255,255,.14)', lineM: 'rgba(255,255,255,.09)', lineDim: 'rgba(255,255,255,.03)', inn: '#c9ccd1', key: 'rgba(255,255,255,.4)', keyM: 'rgba(255,255,255,.3)', blue: '#4aa8d8', shade: ['#f7f8f8', '#c9ccd1', '#a4a8b0', '#80858e'] },
    light: { bg: '#ffffff', t1: '#16181b', t2: '#4a4f57', t3: '#6b7079', dim: '#c9ccd1', line: 'rgba(0,0,0,.24)', lineM: 'rgba(0,0,0,.2)', lineDim: 'rgba(0,0,0,.05)', inn: '#5d6168', key: 'rgba(0,0,0,.45)', keyM: 'rgba(0,0,0,.35)', blue: '#1d89bd', shade: ['#16181b', '#3c4047', '#5d6168', '#80858e'] },
  };
  SM.THEMES = THEMES;
  const theme = (name) => THEMES[name] || THEMES.dark;
  SM.css = function (name) {
    const t = theme(name);
    return 'text{font-family:' + FONT + '}' +
      '.sm-lab{fill:' + t.t2 + '}.sm-lab.on{fill:' + t.t1 + ';font-weight:600}.sm-lab.dim{fill:' + t.dim + '}' +
      '.sm-grp{fill:' + t.t3 + ';font-weight:600}' +
      '.sm-e{fill:none;stroke:' + t.line + ';stroke-width:1}.sm-e.m{stroke-dasharray:3 3;stroke:' + t.lineM + '}' +
      '.sm-e.dim{stroke:' + t.lineDim + '}.sm-e.in{stroke:' + t.inn + ';stroke-width:1.5}' +
      '.sm-e.h1{stroke:' + t.blue + ';stroke-width:1.8}.sm-e.h2{stroke:' + t.blue + ';stroke-opacity:.55;stroke-width:1.4}.sm-e.h3{stroke:' + t.blue + ';stroke-opacity:.3;stroke-width:1.2}' +
      '.sm-arc{fill:none;stroke-width:2;stroke-linecap:round}.sm-hot{fill:none;stroke:' + t.blue + ';stroke-width:1.8}';
  };

  // Links leaving and reaching each dot, and whether chains follow hand-offs only.
  const cache = new WeakMap();
  function wire(map) {
    if (cache.has(map)) return cache.get(map);
    const out = map.nodes.map(() => []), inn = map.nodes.map(() => []);
    map.links.forEach((l, k) => { out[l.s].push(k); inn[l.t].push(k); });
    // When a repo has hand-offs, chains follow them. A repo that only mentions other skills chains through mentions.
    const loadOnly = map.links.filter((l) => l.load).length >= 3;
    const w = { out, inn, loadOnly, chainLink: (k) => !loadOnly || !!map.links[k].load };
    cache.set(map, w);
    return w;
  }
  SM.wire = wire;

  // Every dot reachable from one skill by following its chain links, with how many steps away it is.
  function reach(map, from, maxHop) {
    const w = wire(map), hop = new Map([[from, 0]]), lhop = new Map();
    let front = [from];
    for (let h = 1; h <= (maxHop || 4) && front.length; h++) {
      const next = [];
      for (const i of front) for (const k of w.out[i]) {
        if (!w.chainLink(k)) continue;
        const t = map.links[k].t;
        if (!lhop.has(k)) lhop.set(k, h);
        if (!hop.has(t)) { hop.set(t, h); next.push(t); }
      }
      front = next;
    }
    return { hop, lhop };
  }
  SM.reach = reach;

  // The longest chain from one skill, as dot numbers, for the panel. Capped so a dense repo stays quick.
  SM.longestChain = function (map, from) {
    const w = wire(map);
    let best = [from], steps = 0;
    const walk = (i, path, seen) => {
      if (++steps > 4000) return;
      if (path.length > best.length) best = path.slice();
      if (path.length > 6) return;
      for (const k of w.out[i]) {
        if (!w.chainLink(k)) continue;
        const t = map.links[k].t;
        if (seen.has(t)) continue;
        seen.add(t); path.push(t); walk(t, path, seen); path.pop(); seen.delete(t);
      }
    };
    walk(from, [from], new Set([from]));
    return best;
  };

  // A few chains to play: from the skills that hand off most, each step to the next skill that hands off most.
  function chains(map, k) {
    const w = wire(map);
    const outs = map.nodes.map((_, i) => w.out[i].filter(w.chainLink));
    const deg = outs.map((x) => x.length);
    const cands = [];
    map.nodes.forEach((_, s) => {
      if (!deg[s]) return;
      const seen = new Set([s]), path = [];
      let cur = s;
      while (path.length < 4) {
        const c = outs[cur].filter((l) => !seen.has(map.links[l].t))
          .sort((a, b) => deg[map.links[b].t] - deg[map.links[a].t] || map.links[b].n - map.links[a].n || a - b);
        if (!c.length) break;
        path.push(c[0]); cur = map.links[c[0]].t; seen.add(cur);
      }
      cands.push(path);
    });
    cands.sort((a, b) => b.length - a.length || deg[map.links[b[0]].s] - deg[map.links[a[0]].s] || a[0] - b[0]);
    const out = [], used = new Set();
    for (const c of cands) {
      if (out.length >= k) break;
      // Skip a chain that mostly repeats one already chosen.
      if (c.filter((l) => !used.has(l)).length < Math.ceil(c.length / 2)) continue;
      out.push(c); c.forEach((l) => used.add(l));
    }
    return out;
  }
  SM.chains = chains;

  // ------------------------------------------------------------ what's shown
  const lonely = (map) => { const linked = new Set(); map.links.forEach((l) => { linked.add(l.s); linked.add(l.t); }); return map.nodes.filter((n, i) => n.k === 'skill' && !linked.has(i)).length; };
  // A big repo starts with only the skills that have links, so the ring stays readable.
  SM.CROWDED = 60;
  SM.crowded = (map) => map.nodes.filter((n) => n.k === 'skill').length > SM.CROWDED && map.links.length > 0 && lonely(map) > 0;
  SM.linkedOnly = function (map) {
    const keep = new Set();
    map.links.forEach((l) => { keep.add(l.s); keep.add(l.t); });
    const idx = [];
    let c = 0;
    map.nodes.forEach((n, i) => { idx[i] = keep.has(i) ? c++ : -1; });
    const used = new Set(map.nodes.filter((n, i) => keep.has(i)).map((n) => n.g));
    const gIdx = [], groups = [];
    map.groups.forEach((g, i) => { if (used.has(i)) { gIdx[i] = groups.length; groups.push(g); } });
    return Object.assign({}, map, {
      groups,
      nodes: map.nodes.filter((n, i) => keep.has(i)).map((n) => Object.assign({}, n, { g: n.g < 0 ? n.g : gIdx[n.g] })),
      links: map.links.map((l) => Object.assign({}, l, { s: idx[l.s], t: idx[l.t] })),
    });
  };
  // The map as shown. o.mentions false keeps hand-offs only, when there are any. o.show is 'all', 'linked'
  // (only skills with links) or 'auto' (linked for a big repo).
  SM.derive = function (map, o) {
    o = o || {};
    let m = map;
    if (o.mentions === false && map.links.some((l) => l.load)) m = Object.assign({}, m, { links: m.links.filter((l) => l.load) });
    const show = o.show || 'auto';
    if (m.links.length && lonely(m) && (show === 'linked' || (show === 'auto' && SM.crowded(m)))) m = SM.linkedOnly(m);
    return m;
  };
  SM.hasLonely = (map) => lonely(map) > 0;

  // Where each dot sits. box: { W, H, left, right, top, bottom, labelMax, labels, scale }.
  function layout(map, box) {
    const W = box.W, H = box.H, l = box.left || 0, r = box.right || 0, t = box.top || 0, b = box.bottom || 0;
    const sc = box.scale || 1, labels = box.labels !== false;
    const cx = l + (W - l - r) / 2, cy = t + (H - t - b) / 2;
    const labelMax = box.labelMax || 25;
    const longest = Math.min(labelMax, Math.max(4, ...map.nodes.map((n) => n.id.length)));
    // Start files at the top, then each group, with skills by name inside it.
    const order = [];
    const all = map.nodes.map((n, i) => i);
    const start = all.filter((i) => map.nodes[i].k === 'start');
    if (start.length) order.push({ g: -1, name: '', idx: start });
    map.groups.forEach((name, g) => {
      const idx = all.filter((i) => map.nodes[i].k !== 'start' && map.nodes[i].g === g).sort((a, b) => map.nodes[a].id.localeCompare(map.nodes[b].id));
      if (idx.length) order.push({ g, name, idx });
    });
    const GAP = order.length > 1 ? 2.2 : 0;
    const slots = Math.max(1, map.nodes.length + GAP * order.length);
    // Labels need room outside the ring. A crowded ring gets smaller labels.
    let fs = 12 * sc, R = 0;
    for (let k = 0; k < 4; k++) {
      const room = labels ? longest * fs * 0.56 + 20 * sc : 16 * sc;
      R = Math.max(70, Math.min((W - l - r) / 2, (H - t - b) / 2) - room);
      const per = (2 * Math.PI * R) / slots;
      const want = Math.max(7 * sc, Math.min(12 * sc, per * 0.9));
      if (Math.abs(want - fs) < 0.2) break;
      fs = want;
    }
    const ang = (v) => (v / slots) * Math.PI * 2 - Math.PI / 2;
    const pos = new Array(map.nodes.length);
    let s = GAP / 2;
    order.forEach((o) => {
      const a0 = s;
      o.idx.forEach((i) => { const a = ang(s); pos[i] = { a, x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R }; s += 1; });
      o.a0 = ang(a0); o.a1 = ang(s - 1); o.am = (o.a0 + o.a1) / 2;
      s += GAP;
    });
    const byG = new Map(order.map((o) => [o.g, o]));
    return { cx, cy, R, pos, order, byG, fs, sc, labels, labelMax, grouped: order.length > 1 };
  }
  SM.layout = layout;

  // A link's curve. Inside one group it bows toward the middle, more for skills further apart.
  // Between groups it runs through each group's hub, so lines between two groups bundle together.
  function edgeD(L, map, l) {
    const a = L.pos[l.s], b = L.pos[l.t], cx = L.cx, cy = L.cy, R = L.R;
    const ga = map.nodes[l.s].g, gb = map.nodes[l.t].g;
    if (ga === gb || !L.grouped) {
      let d = Math.abs(a.a - b.a) % (2 * Math.PI);
      if (d > Math.PI) d = 2 * Math.PI - d;
      let am = Math.atan2(Math.sin(a.a) + Math.sin(b.a), Math.cos(a.a) + Math.cos(b.a));
      if (!isFinite(am)) am = a.a + Math.PI / 2;
      const f = 0.85 * (1 - d / Math.PI);
      return 'M' + r1(a.x) + ' ' + r1(a.y) + 'Q' + r1(cx + Math.cos(am) * R * f) + ' ' + r1(cy + Math.sin(am) * R * f) + ' ' + r1(b.x) + ' ' + r1(b.y);
    }
    const hub = (g) => { const o = L.byG.get(g); return [cx + Math.cos(o.am) * R * 0.42, cy + Math.sin(o.am) * R * 0.42]; };
    const c1 = hub(ga), c2 = hub(gb);
    return 'M' + r1(a.x) + ' ' + r1(a.y) + 'C' + r1(c1[0]) + ' ' + r1(c1[1]) + ' ' + r1(c2[0]) + ' ' + r1(c2[1]) + ' ' + r1(b.x) + ' ' + r1(b.y);
  }

  // Dot sizes. 'in' (the default, as in the skills graph it came from): how many skills link to it.
  // 'named': every sentence that names it. 'out': how many skills it names. 'same': one size.
  SM.SIZES = { in: 'Linked from', named: 'Times named', out: 'Links out', same: 'Same size' };
  SM.dotValue = function (map, i, by) {
    const w = wire(map);
    return by === 'named' ? w.inn[i].reduce((a, k) => a + map.links[k].n, 0) : by === 'out' ? w.out[i].length : w.inn[i].length;
  };
  function dotSizes(map, by) {
    const vals = map.nodes.map((_, i) => SM.dotValue(map, i, by));
    const max = Math.max(1, ...vals);
    return map.nodes.map((n, i) => {
      if (n.k === 'start') return 6.5;
      if (by === 'same') return 4;
      if (by === 'named' || by === 'out') return 2.6 + 3.4 * Math.sqrt(vals[i] / max);
      return Math.min(6, 2.6 + 0.8 * Math.sqrt(vals[i]));
    });
  }

  // Times for SMIL keyTimes: each between 0 and 1 and never smaller than the one before.
  function kt(list) {
    let last = 0;
    return list.map((v, i) => { v = i === 0 ? 0 : i === list.length - 1 ? 1 : Math.min(1, Math.max(last, v)); last = v; return v.toFixed(4).replace(/\.?0+$/, '') || '0'; }).join(';');
  }
  // One step of a chain: a pulse runs along the line from a to b (shares of the loop T), the line stays lit
  // until e and fades by f, and the skill it reaches flashes a ring.
  function step(d, a, b, e, f, T, q, rr, t, sc, lit) {
    const dur = ' dur="' + r1(T) + 's" repeatCount="indefinite"';
    let h = '';
    if (lit) h += '<path class="sm-hot" d="' + d + '" opacity="0"><animate attributeName="opacity" values="0;0;.9;.9;0;0" keyTimes="' + kt([0, a, b, e, f, 1]) + '"' + dur + '/></path>';
    h += '<circle r="' + r1(2.8 * sc) + '" fill="' + t.blue + '" opacity="0"><animateMotion path="' + d + '" keyPoints="0;0;1;1" keyTimes="' + kt([0, a, b, 1]) + '" calcMode="linear"' + dur + '/>' +
      '<animate attributeName="opacity" values="0;0;1;1;0;0" keyTimes="' + kt([0, a, a + 0.002, b, b + 0.002, 1]) + '"' + dur + '/></circle>';
    h += '<circle cx="' + r1(q.x) + '" cy="' + r1(q.y) + '" r="' + r1(rr) + '" fill="none" stroke="' + t.blue + '" stroke-width="1.6" opacity="0"><animate attributeName="opacity" values="0;0;1;0;0" keyTimes="' + kt([0, b, b + 0.02, b + 0.09, 1]) + '"' + dur + '/></circle>';
    return h;
  }
  const HOP = 0.9;
  // Chains firing one after another, each staying lit until it ends.
  function pulses(map, L, paths, dotRs, t) {
    const list = chains(map, Math.min(7, Math.max(1, Math.round(map.links.length / 4))));
    if (!list.length) return '';
    const STAGGER = 1.4, HOLD = 0.7, FADE = 0.6;
    const plan = list.map((c, ci) => ({ c, t0: ci * STAGGER, end: ci * STAGGER + c.length * HOP }));
    const T = Math.max(...plan.map((p) => p.end)) + HOLD + FADE + 1.2;
    let h = '';
    for (const p of plan) p.c.forEach((k, hi) => {
      const tgt = map.links[k].t;
      h += step(paths[k], (p.t0 + hi * HOP) / T, (p.t0 + (hi + 1) * HOP) / T, (p.end + HOLD) / T, (p.end + HOLD + FADE) / T, T, L.pos[tgt], dotRs[tgt] + 4 * L.sc, t, L.sc, true);
    });
    return h;
  }
  // One lit skill's chain firing outward, one step at a time.
  function focusPulses(map, L, R, paths, dotRs, t) {
    const hops = [...R.lhop.values()];
    if (!hops.length) return '';
    const T = Math.max(...hops) * HOP + 1.6;
    let h = '';
    R.lhop.forEach((hp, k) => {
      const tgt = map.links[k].t;
      h += step(paths[k], ((hp - 1) * HOP) / T, (hp * HOP) / T, 1, 1, T, L.pos[tgt], dotRs[tgt] + 4 * L.sc, t, L.sc, false);
    });
    return h;
  }

  // The map as SVG markup, without the outer <svg> tag. o: the box for layout(), plus focus (a dot to light up
  // with its chains), sel (the dot with a ring), animate (play chains), sizeBy, labels and theme.
  SM.render = function (map, o) {
    const L = layout(map, o), w = wire(map), t = theme(o.theme), sc = L.sc;
    const focus = o.focus != null && o.focus >= 0 && o.focus < map.nodes.length ? o.focus : null;
    const R = focus != null ? reach(map, focus) : null;
    const up = new Set();
    if (focus != null) w.inn[focus].forEach((k) => up.add(map.links[k].s));
    const lit = (i) => focus == null || R.hop.has(i) || up.has(i);
    const shade = (g) => (g < 0 ? t.t1 : t.shade[g % t.shade.length]);
    let h = '<style>' + SM.css(o.theme) + '</style>';

    // Group arcs, and group names inside the ring where they touch no other name.
    const names = [];
    if (L.grouped) L.order.forEach((g) => {
      if (g.g < 0) return;
      const rr = L.R - 12 * sc, a0 = g.a0 - 0.012, a1 = g.a1 + 0.012;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      h += '<path class="sm-arc" stroke="' + shade(g.g) + '" stroke-opacity=".55" d="M' + r1(L.cx + Math.cos(a0) * rr) + ' ' + r1(L.cy + Math.sin(a0) * rr) + 'A' + r1(rr) + ' ' + r1(rr) + ' 0 ' + large + ' 1 ' + r1(L.cx + Math.cos(a1) * rr) + ' ' + r1(L.cy + Math.sin(a1) * rr) + '"/>';
      // Past ten groups the names would pile up, so the arcs alone mark them.
      if (g.idx.length < 2 || !g.name || L.order.length > 10) return;
      const text = g.name, wd = (text.length * 7 + 6) * sc;
      const anchor = Math.abs(Math.cos(g.am)) < 0.3 ? 'middle' : Math.cos(g.am) > 0 ? 'end' : 'start';
      let box = null;
      for (const depth of [30, 52, 74, 96, 118]) {
        const gx = L.cx + Math.cos(g.am) * (L.R - depth * sc), gy = L.cy + Math.sin(g.am) * (L.R - depth * sc);
        const x0 = anchor === 'middle' ? gx - wd / 2 : anchor === 'end' ? gx - wd : gx;
        box = { gx, gy, x0, x1: x0 + wd, y0: gy - 10 * sc, y1: gy + 8 * sc };
        if (!names.some((nb) => !(box.x1 < nb.x0 || box.x0 > nb.x1 || box.y1 < nb.y0 || box.y0 > nb.y1))) break;
      }
      names.push(box);
      box.html = '<text class="sm-grp" font-size="' + r1(12 * sc) + '" x="' + r1(box.gx) + '" y="' + r1(box.gy + 4 * sc) + '" text-anchor="' + anchor + '" stroke="' + t.bg + '" stroke-width="4" paint-order="stroke">' + esc(text) + '</text>';
    });

    // Lines, with the lit ones drawn last so they sit on top.
    const paths = map.links.map((l) => edgeD(L, map, l));
    const edges = map.links.map((l, k) => {
      let cls = 'sm-e' + (l.load ? '' : ' m'), rank = 0;
      if (focus != null) {
        if (R.lhop.has(k)) { cls += ' h' + Math.min(3, R.lhop.get(k)); rank = 4 - Math.min(3, R.lhop.get(k)); }
        else if (l.s === focus) { cls += ' h2'; rank = 2; }
        else if (l.t === focus) { cls += ' in'; rank = 1; }
        else cls += ' dim';
      }
      return [rank, '<path class="' + cls + '" d="' + paths[k] + '"/>'];
    });
    edges.sort((a, b) => a[0] - b[0]);
    h += edges.map((e) => e[1]).join('');
    h += names.map((b) => b.html).join('');

    const dotRs = dotSizes(map, o.sizeBy).map((r) => r * sc);
    if (o.animate) h += focus == null ? pulses(map, L, paths, dotRs, t) : focusPulses(map, L, R, paths, dotRs, t);

    // Dots and labels.
    const cut = Math.max(6, L.labelMax);
    h += '<g font-size="' + r1(L.fs) + '">';
    map.nodes.forEach((n, i) => {
      const q = L.pos[i], rr = dotRs[i], on = focus === i, dim = !lit(i);
      const col = shade(n.g);
      h += '<g class="sm-n" data-i="' + i + '">';
      h += '<circle cx="' + r1(q.x) + '" cy="' + r1(q.y) + '" r="' + r1(rr + 6) + '" fill="transparent"/>';
      h += '<circle cx="' + r1(q.x) + '" cy="' + r1(q.y) + '" r="' + r1(rr) + '" fill="' + (n.k === 'start' ? t.bg : col) + '"' + (n.k === 'start' ? ' stroke="' + col + '" stroke-width="1.6"' : '') + (dim ? ' opacity=".25"' : '') + '/>';
      if (o.sel === i || on) h += '<circle cx="' + r1(q.x) + '" cy="' + r1(q.y) + '" r="' + r1(rr + 3.5 * sc) + '" fill="none" stroke="' + t.blue + '" stroke-width="1.6"/>';
      if (L.labels) {
        const deg = (q.a * 180) / Math.PI, flip = Math.cos(q.a) < 0;
        const lx = L.cx + Math.cos(q.a) * (L.R + 12 * sc), ly = L.cy + Math.sin(q.a) * (L.R + 12 * sc);
        const label = n.id.length > cut ? n.id.slice(0, cut - 1) + '…' : n.id;
        h += '<text class="sm-lab' + (focus != null && lit(i) ? ' on' : '') + (dim ? ' dim' : '') + '" x="' + r1(lx) + '" y="' + r1(ly) + '" dy=".33em" text-anchor="' + (flip ? 'end' : 'start') + '" transform="rotate(' + r1(flip ? deg + 180 : deg) + ' ' + r1(lx) + ' ' + r1(ly) + ')">' + esc(label) + '</text>';
      }
      h += '</g>';
    });
    h += '</g>';
    return { svg: h, layout: L };
  };

  // Image sizes. readme: for a GitHub README. square: a LinkedIn or social post. wide: 16:9 for slides and link previews.
  // k scales the text and dots. top keeps the labels clear of the title and subtitle.
  SM.FORMATS = {
    readme: { W: 900, H: 940, k: 1, top: 70, bottom: 46, labelMax: 25 },
    square: { W: 1200, H: 1200, k: 1.25, top: 92, bottom: 60, labelMax: 25 },
    wide: { W: 1200, H: 675, k: 1, top: 70, bottom: 18, labelMax: 20 },
  };
  // An image of the map on its own card, with a title, a small key and the Skill Map name.
  // o: { format, theme, sizeBy, mentions, labels, show, animate (default true), focus (a skill's name), title, png }.
  // png drops the rounded corners, so a still fills its frame.
  SM.image = function (map, o) {
    o = o || {};
    const f = SM.FORMATS[o.format] || SM.FORMATS.readme, t = theme(o.theme), k = f.k, W = f.W, H = f.H;
    let shown = SM.derive(map, o);
    // A lit skill stays in the image even when "only skills with links" would leave it out.
    if (o.focus && !shown.nodes.some((n) => n.id === o.focus) && map.nodes.some((n) => n.id === o.focus)) shown = SM.derive(map, Object.assign({}, o, { show: 'all' }));
    const title = o.title || SM.title(map);
    const nSkills = map.nodes.filter((n) => n.k === 'skill').length, nl = map.links.length;
    let sub = nSkills + (nSkills === 1 ? ' skill, ' : ' skills, ') + nl + (nl === 1 ? ' link' : ' links');
    const shownSkills = shown.nodes.filter((n) => n.k === 'skill').length;
    if (shownSkills < nSkills) sub += '. Showing the ' + shownSkills + ' with links.';
    else if (shown.links.length < nl) sub += '. Hand-offs only.';
    const focus = o.focus != null && o.focus !== '' ? shown.nodes.findIndex((n) => n.id === o.focus) : -1;
    if (focus >= 0) sub = 'The chains from ' + shown.nodes[focus].id + '. ' + sub;
    const animate = o.animate !== false;
    const body = SM.render(shown, { W, H, top: f.top, bottom: f.bottom, left: 10, right: 10, labelMax: f.labelMax, scale: k, theme: o.theme, sizeBy: o.sizeBy, labels: o.labels, focus, sel: focus, animate }).svg;
    const y = H - 22 * k, fs = r1(12 * k), x = (v) => r1(28 * k + v * k);
    // The key lists only what the image shows.
    let key = '<g font-size="' + fs + '" fill="' + t.t3 + '">', at = 0;
    const line = (dash, stroke, text, width) => { key += '<path d="M' + x(at) + ' ' + r1(y - 4 * k) + 'h' + r1(18 * k) + '" stroke="' + stroke + '" stroke-width="1.2"' + (dash ? ' stroke-dasharray="3 3"' : '') + '/><text x="' + x(at + 24) + '" y="' + r1(y) + '">' + text + '</text>'; at += width; };
    if (shown.links.some((l) => l.load)) line(false, t.key, 'Hands off', 96);
    if (shown.links.some((l) => !l.load)) line(true, t.keyM, 'Mentions', 98);
    if ((animate || focus >= 0) && shown.links.length) key += '<circle cx="' + x(at) + '" cy="' + r1(y - 4 * k) + '" r="' + r1(3 * k) + '" fill="' + t.blue + '"/><text x="' + x(at + 10) + '" y="' + r1(y) + '">' + (focus >= 0 ? 'Its chain' : 'A chain running') + '</text>';
    key += '</g>';
    const brand = '<text x="' + r1(W - 28 * k) + '" y="' + r1(y) + '" text-anchor="end" font-size="' + r1(13 * k) + '" font-weight="600" fill="' + t.t2 + '">Skill Map<tspan fill="' + t.blue + '">.</tspan></text>';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Skill map of ' + esc(title) + ': ' + esc(sub) + '">' +
      '<title>Skill map of ' + esc(title) + '</title>' +
      '<rect width="' + W + '" height="' + H + '"' + (o.png ? '' : ' rx="14"') + ' fill="' + t.bg + '"/>' +
      '<text x="' + x(0) + '" y="' + r1(40 * k) + '" font-size="' + r1(19 * k) + '" font-weight="600" fill="' + t.t1 + '">' + esc(title) + '</text>' +
      '<text x="' + x(0) + '" y="' + r1(61 * k) + '" font-size="' + r1(13 * k) + '" fill="' + t.t3 + '">' + esc(sub) + '</text>' +
      body + key + brand + '</svg>';
  };
})(typeof window !== 'undefined' ? window : globalThis);
