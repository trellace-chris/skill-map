// Skill Map scanner. Finds the skills in a repo and every sentence where one skill points at another.
// A plain script with no outside code, so the web page and the Node script share one copy.
(function (root) {
  'use strict';
  const SM = root.SkillMap || (root.SkillMap = {});

  SM.LIVE = 'https://trellace-chris.github.io/skill-map/';
  // Big enough for large repos, small enough that a browser reads it all in under a minute.
  const MAX_FILES = 800, MAX_PER_SKILL = 60, MAX_CHARS = 300000;
  SM.LIMITS = { files: MAX_FILES, perSkill: MAX_PER_SKILL };
  SM.PATTERNS = ['code', 'prefix', 'link', 'slash', 'phrase', 'alias'];

  const norm = (p) => String(p).replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/^\/+/, '');
  const SKIP = /(^|\/)(node_modules|\.git|__pycache__|\.venv|venv)(\/|$)/;
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

  // One folder or file name against a pattern with * and ?. It steps back only to the last *, so a pattern
  // from someone else's rules file can't make it run for long.
  function nameMatch(p, s) {
    p = p.toLowerCase(); s = s.toLowerCase();
    let i = 0, j = 0, star = -1, mark = 0;
    while (j < s.length) {
      if (i < p.length && (p[i] === '?' || p[i] === s[j])) { i++; j++; }
      else if (i < p.length && p[i] === '*') { star = i++; mark = j; }
      else if (star >= 0) { i = star + 1; j = ++mark; }
      else return false;
    }
    while (p[i] === '*') i++;
    return i === p.length;
  }
  // A path pattern such as "examples" or "**/templates". A folder matches everything inside it.
  function globMatcher(g) {
    const pat = norm(g).replace(/\/+$/, '').split('/').filter(Boolean);
    return (path) => {
      const segs = path.split('/'), memo = new Map();
      const m = (pi, si) => {
        const key = pi * 4096 + si;
        if (memo.has(key)) return memo.get(key);
        let r;
        if (pi === pat.length) r = true;
        else if (pat[pi] === '**') r = m(pi + 1, si) || (si < segs.length && m(pi, si + 1));
        else r = si < segs.length && nameMatch(pat[pi], segs[si]) && m(pi + 1, si + 1);
        memo.set(key, r);
        return r;
      };
      return pat.length > 0 && m(0, 0);
    };
  }
  // A rules field as a list of strings, whatever was written.
  const list = (x) => [].concat(x == null ? [] : x).map(String);

  // Small frontmatter reader: top-level keys with plain, quoted or folded (> or |) values.
  function frontmatter(text) {
    text = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const m = text.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
    if (!m) return { fm: {}, body: text };
    const fm = {}, lines = m[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      const kv = lines[i].match(/^([A-Za-z0-9_-]+):[ \t]*(.*)$/);
      if (!kv) continue;
      let v = kv[2].trim();
      if (/^[>|][+-]?$/.test(v)) {
        const parts = [];
        while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) parts.push(lines[++i].trim());
        v = parts.join(v[0] === '>' ? ' ' : '\n').trim();
      } else if (/^["']/.test(v)) {
        const q = v[0], end = v.lastIndexOf(q);
        v = end > 0 ? v.slice(1, end) : v.slice(1);
        v = q === '"' ? v.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : v.replace(/''/g, "'");
      } else {
        while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !/^\s+[\w-]+:\s/.test(lines[i + 1])) v += ' ' + lines[++i].trim();
      }
      fm[kv[1]] = v;
    }
    return { fm, body: text.slice(m[0].length) };
  }
  SM.frontmatter = frontmatter;

  // Which files to read. A skill is a folder with a SKILL.md. One inside another skill's folder
  // belongs to that skill, such as a template or an example. Every other Markdown file in a skill's
  // folder is part of it too, such as its references.
  function plan(paths, rules) {
    rules = rules || {};
    const ex = list(rules.exclude).map(globMatcher);
    const all = [...new Set(paths.map(norm))].filter((p) => p && !SKIP.test(p) && !ex.some((f) => f(p)));
    const has = new Set(all);
    const skillFile = new Map();
    for (const p of all) { const m = p.match(/^(?:(.*)\/)?SKILL\.md$/i); if (m) skillFile.set(m[1] || '', p); }
    const skills = [];
    for (const d of [...skillFile.keys()].sort((a, b) => a.length - b.length)) if (!skills.some((s) => s && d.startsWith(s + '/'))) skills.push(d);
    skills.sort();
    const main = skills.map((d) => skillFile.get(d));
    const isMain = new Set(main);
    const ownerOf = (p) => { let best = null; for (const s of skills) if ((s === '' || p.startsWith(s + '/')) && (best === null || s.length > best.length)) best = s; return best; };
    const start = list(rules.start).map(norm).filter((p) => has.has(p) && !isMain.has(p));
    const extra = [], per = new Map();
    let capped = 0;
    // Files nearest a skill's SKILL.md come first, so a cap leaves out the deepest ones.
    const depth = (p) => p.split('/').length;
    for (const p of all.slice().sort((a, b) => depth(a) - depth(b) || (a < b ? -1 : a > b ? 1 : 0))) {
      if (!/\.md$/i.test(p) || isMain.has(p) || start.includes(p)) continue;
      const s = ownerOf(p);
      if (s === null) continue;
      const c = per.get(s) || 0;
      if (c >= MAX_PER_SKILL) { capped++; continue; }
      per.set(s, c + 1); extra.push(p);
    }
    let files = main.concat(start, extra);
    if (files.length > MAX_FILES) { capped += files.length - MAX_FILES; files = files.slice(0, MAX_FILES); }
    return { skills, main, start, files, capped, ownerOf };
  }
  SM.plan = plan;

  // One sentence, one named skill: 'false' when the name means something else, 'load' when the
  // sentence sends the agent to that skill, 'mention' otherwise. Every reference is first rewritten
  // as the name in backticks, so one set of rules covers every way a repo names a skill.
  const LOAD = /\b(load|loads|loaded|loading|calls?\s+(?:the|it|this|`)|invoke|invokes|hand|hands|handed|route|routes|belongs? to|go(?:es)? to|through|via|use|uses|using|follow|follows|open|opens|run|runs|switch|launch|ask|asks|offer|covers|owns|starts? at|look for|next step)\b/i;
  function makeClassify(names) {
    return function classify(sen, name) {
      const R = (src) => new RegExp(src.replace(/NAME/g, '`' + reEsc(name) + '`'), 'i');
      // Only name-shaped words count toward a list of values. File paths, flags and commands don't.
      const toks = [...sen.matchAll(/`([^`]+)`/g)].map((x) => x[1]).filter((t) => /^[a-z0-9][a-z0-9-]*$/.test(t));
      // False hits: a label, a column or field, a command, a defined term, or one item in a list of values.
      if (R('label(?:s|led|ed)?\\s+NAME').test(sen)) return 'false';
      if (R('NAME\\s+(?:profile\\s+)?(?:section|column|field|label|tag|value|cli|command|key|status|flag)s?\\b').test(sen)) return 'false';
      if (R('^\\W*NAME\\s+means\\b').test(sen)) return 'false';
      if (toks.length >= 3 && toks.filter((t) => names.has(t)).length / toks.length < 0.5) return 'false';
      // Mentions that look like loads: example prompts, the other skill loading this one, what the person does,
      // a list of neighbours, an instruction not to load it, or an example of a kind of skill.
      if (R('NAME\\s*(?:\\||→|:|-)?\\s*["“]').test(sen)) return 'mention';
      if (R('NAME\\s+(?:loads|calls|uses|asks for|opens|reads)\\s+(?:it|this|one)\\b').test(sen)) return 'mention';
      if (/\b(the|a) (person|user)\s+(runs?|moves?|can|files?|uses?|starts?|chooses?)\b|\bwho can\b/i.test(sen) && !/\b(so|tells?|asks?) the (person|user)\b/i.test(sen)) return 'mention';
      if (/\bneighbou?rs?\b/i.test(sen)) return 'mention';
      if (/\b(don't|do not|never)\s+(load|use|call|run)\b/i.test(sen) && !/\btell\b/i.test(sen)) return 'mention';
      if (R('such as NAME').test(sen) && !/\b(load|call|follow)\b/i.test(sen)) return 'mention';
      if (R('\\bby NAME').test(sen)) return 'mention';
      if (R('\\bkeep\\b[^.]*\\bin NAME').test(sen)) return 'load';
      // Loads: a load-style verb, a routing table row, or a trigger list item such as "- `name`: when ...".
      if (LOAD.test(sen) || /^\s*\|/.test(sen) || R('^\\s*[-*]\\s+NAME\\s*:').test(sen)) return 'load';
      return 'mention';
    };
  }
  SM.makeClassify = makeClassify;

  // Rough sentences: blocks split at blank lines and at list items, table rows, headings and numbers,
  // then at full stops.
  function sentences(text) {
    const out = [];
    for (const block of text.replace(/\r/g, '').split(/\n{2,}|\n(?=[-*|#\d])/)) {
      const re = /[.!?]\s+/g;
      let last = 0, m;
      while ((m = re.exec(block))) { out.push(block.slice(last, m.index + 1)); last = m.index + m[0].length; }
      if (last < block.length) out.push(block.slice(last));
    }
    return out.filter((s) => s.trim());
  }

  // A sentence as plain text for the panel: link text only, no bold, table cells read as "this → that".
  const cleanSentence = (sen) => sen.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
    .replace(/^\|\s*/, '').replace(/\s*\|$/, '').replace(/\s*\|\s*\|?\s*/g, ' → ').replace(/^#+\s*/, '').replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, '');

  // Words before a colon that are never a namespace for skills.
  const NOT_PREFIX = new Set(['http', 'https', 'mailto', 'file', 'ftp', 'git', 'ssh', 'data', 'javascript', 'skill', 'skills', 'label', 'tag', 'type', 'step', 'mode', 'id', 'name', 'key', 'note', 'example']);
  const PREFIX_RE = /(^|[^\w/@.:-])([a-z0-9][\w-]*):([a-z0-9][a-z0-9-]*)(?![\w:-])/gi;

  // files: [{ path, text }]. opts: { rules, plan, name }. Returns the map: groups, nodes, links and stats.
  function scan(files, opts) {
    opts = opts || {};
    const rules = opts.rules || {};
    const texts = new Map();
    for (const f of files) texts.set(norm(f.path), String(f.text == null ? '' : f.text).slice(0, MAX_CHARS));
    const p = opts.plan || plan([...texts.keys()], rules);
    const off = new Set(list(rules.off).map((x) => x.toLowerCase()));
    const ignore = new Set(list(rules.ignore).map((x) => x.toLowerCase()));

    // Groups: the first folder that tells skills apart, after the folders they all share.
    const segs = p.skills.map((d) => (d ? d.split('/').slice(0, -1) : []));
    let common = 0;
    while (segs.length && segs.every((s) => s.length > common && s[common] === segs[0][common])) common++;
    const gOf = segs.map((s) => s[common] || '');
    const groups = [...new Set(gOf)].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));

    const nodes = p.skills.map((d, i) => {
      const f = p.main[i];
      const { fm, body } = frontmatter(texts.get(f) || '');
      const folder = d ? d.split('/').pop() : String(opts.name || 'skill');
      const name = oneLine(fm.name || folder) || folder;
      return { id: name, name, folder, g: groups.indexOf(gOf[i]), k: 'skill', d: clip(oneLine(fm.description || ''), 320), f, dir: d, body };
    });
    // Two skills with one name get their folder added, so each dot has its own name.
    const dup = new Map();
    nodes.forEach((n) => dup.set(n.id.toLowerCase(), (dup.get(n.id.toLowerCase()) || 0) + 1));
    nodes.forEach((n) => { if (dup.get(n.id.toLowerCase()) > 1) n.id = n.id + ' (' + (n.dir.split('/').slice(-2, -1)[0] || 'top') + ')'; });
    // Files read at the start of every session, such as AGENTS.md, when the rules name them.
    p.start.forEach((f) => nodes.push({ id: f, name: null, folder: null, g: -1, k: 'start', d: 'Read at the start of every session, so each skill it names is in reach from the start.', f, dir: null, body: texts.get(f) || '' }));

    const byName = new Map();
    const addName = (k, i) => { if (!k) return; k = k.toLowerCase(); if (!byName.has(k)) byName.set(k, []); if (!byName.get(k).includes(i)) byName.get(k).push(i); };
    nodes.forEach((n, i) => { if (n.k === 'skill') { addName(n.name, i); addName(n.folder, i); } });
    const names = new Set(byName.keys());
    const classify = makeClassify(names);
    const resolve = (tok, from) => {
      const k = String(tok).toLowerCase();
      if (ignore.has(k)) return -1;
      const list = byName.get(k);
      if (!list) return -1;
      let i = list[0];
      if (list.length > 1) { const same = list.find((j) => nodes[j].g === nodes[from].g); if (same != null) i = same; }
      return i === from ? -1 : i;
    };

    // Which file belongs to which dot.
    const ownerIdx = new Map();
    nodes.forEach((n, i) => ownerIdx.set(n.f, i));
    const fileOwner = (f) => { if (ownerIdx.has(f)) return ownerIdx.get(f); const d = p.ownerOf(f); return d === null ? -1 : p.skills.indexOf(d); };
    const bodyOf = (f) => { const i = ownerIdx.get(f); return i != null ? nodes[i].body : frontmatter(texts.get(f) || '').body; };

    // Namespaces such as "superpowers:" in "superpowers:writing-plans". A word counts once it comes
    // before two or more skill names, or when the rules name it.
    const tally = new Map();
    for (const f of texts.keys()) {
      const re = new RegExp(PREFIX_RE.source, 'gi');
      let m;
      const t = texts.get(f);
      while ((m = re.exec(t))) {
        const pre = m[2].toLowerCase();
        if (pre.length < 2 || NOT_PREFIX.has(pre) || !byName.has(m[3].toLowerCase())) continue;
        if (!tally.has(pre)) tally.set(pre, new Set());
        tally.get(pre).add(m[3].toLowerCase());
      }
    }
    const prefixes = new Set(list(rules.prefixes).map((x) => x.toLowerCase()));
    tally.forEach((set, pre) => { if (set.size >= 2) prefixes.add(pre); });

    const aliasObj = rules.aliases && typeof rules.aliases === 'object' && !Array.isArray(rules.aliases) ? rules.aliases : {};
    const aliases = Object.entries(aliasObj).filter(([words]) => words.trim()).map(([words, name]) => {
      const list = byName.get(String(name).toLowerCase());
      return list ? [new RegExp('(^|[^\\w-])(' + reEsc(words) + ')(?![\\w-])', 'gi'), list[0]] : null;
    }).filter(Boolean);

    // A bare word counts only in the case the skill is written in, so "PDF" the format isn't the "pdf" skill.
    const exact = (i, tok) => (i >= 0 && (nodes[i].name === tok || nodes[i].folder === tok) ? i : -1);
    const codeRef = (t, from) => {
      let m;
      if ((m = t.match(/(?:^|\/)([^/\s]+)\/SKILL\.md$/i))) return resolve(m[1], from);
      const bare = t.replace(/^[/$@]/, '');
      if (/^[A-Za-z0-9][\w-]*$/.test(bare)) return exact(resolve(bare, from), bare);
      if ((m = bare.match(/^([a-z0-9][\w-]*):([a-z0-9][a-z0-9-]*)$/i)) && prefixes.has(m[1].toLowerCase())) return resolve(m[2], from);
      return -1;
    };
    // A relative link into another skill's folder, to its SKILL.md or any file it keeps.
    const linkRef = (href, file, from) => {
      if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href[0] === '#') return -1;
      let h = href.split('#')[0].split('?')[0];
      try { h = decodeURIComponent(h); } catch (e) { /* keep it as written */ }
      if (!h) return -1;
      const parts = h[0] === '/' ? [] : file.split('/').slice(0, -1);
      for (const seg of h.split('/')) { if (!seg || seg === '.') continue; if (seg === '..') parts.pop(); else parts.push(seg); }
      const target = parts.join('/');
      let best = -1, len = -1;
      nodes.forEach((n, i) => { if (n.k === 'skill' && n.dir && (target === n.dir || target.startsWith(n.dir + '/')) && n.dir.length > len) { best = i; len = n.dir.length; } });
      return best === from || (best >= 0 && ignore.has(nodes[best].name.toLowerCase())) ? -1 : best;
    };

    // Every reference in one sentence, in the order the patterns run. The first of any two that overlap wins.
    function refs(sen, from, file) {
      const found = [];
      const add = (a, b, i, via) => { if (i >= 0) found.push({ a, b, i, via }); };
      let m, re;
      if (!off.has('code')) { re = /`([^`\n]{1,120})`/g; while ((m = re.exec(sen))) add(m.index, m.index + m[0].length, codeRef(m[1].trim(), from), 'code'); }
      if (!off.has('prefix') && prefixes.size) { re = new RegExp(PREFIX_RE.source, 'gi'); while ((m = re.exec(sen))) if (prefixes.has(m[2].toLowerCase())) add(m.index + m[1].length, m.index + m[0].length, resolve(m[3], from), 'prefix'); }
      if (!off.has('link')) { re = /\[([^\]\n]*)\]\(\s*<?([^)>\s]+)>?(?:\s+["'][^)]*["'])?\s*\)/g; while ((m = re.exec(sen))) add(m.index, m.index + m[0].length, linkRef(m[2], file, from), 'link'); }
      // "/name" as a command. One inside brackets, as in "Pricing (/pricing)", is a web address, so it's left out.
      if (!off.has('slash')) { re = /(^|[\s“"'])\/([a-z0-9][a-z0-9-]*)(?=$|[\s.,;:!?"”'])/g; while ((m = re.exec(sen))) add(m.index + m[1].length, m.index + m[0].length, resolve(m[2], from), 'slash'); }
      // "the name skill", in the case the skill is written in. "a PDF skill" names a kind of skill, not the pdf skill.
      if (!off.has('phrase')) { re = /\b([A-Za-z0-9][\w-]*)\s+skills?\b/g; while ((m = re.exec(sen))) add(m.index, m.index + m[1].length, exact(resolve(m[1], from), m[1]), 'phrase'); }
      if (!off.has('alias')) aliases.forEach(([are, i]) => { are.lastIndex = 0; while ((m = are.exec(sen))) add(m.index + m[1].length, m.index + m[0].length, i === from ? -1 : i, 'alias'); });
      const kept = [];
      for (const r of found) if (!kept.some((k) => r.a < k.b && k.a < r.b)) kept.push(r);
      return kept.sort((x, y) => x.a - y.a);
    }

    const edges = new Map();
    const via = {};
    SM.PATTERNS.forEach((k) => { via[k] = 0; });
    let falseHits = 0;
    for (const f of p.files) {
      const from = fileOwner(f);
      if (from < 0 || !texts.has(f)) continue;
      const src = nodes[from];
      const where = f === src.f ? 'main' : f.slice(src.dir ? src.dir.length + 1 : 0);
      for (const sen of sentences(bodyOf(f))) {
        const rs = refs(sen, from, f);
        if (!rs.length) continue;
        // The sentence with every reference written as the name in backticks, for the rules above.
        let normed = '', at = 0;
        for (const r of rs) { normed += sen.slice(at, r.a) + '`' + (nodes[r.i].name || nodes[r.i].id) + '`'; at = r.b; }
        normed += sen.slice(at);
        const seen = new Set();
        for (const r of rs) {
          if (seen.has(r.i)) continue;
          seen.add(r.i);
          const key = from + '>' + r.i;
          const e = edges.get(key) || { s: from, t: r.i, n: 0, load: 0, main: 0, ex: '', at: '', v: new Set() };
          edges.set(key, e);
          const kind = classify(normed, nodes[r.i].name || nodes[r.i].id);
          if (kind === 'false') { falseHits++; continue; }
          e.n++; via[r.via]++; e.v.add(r.via);
          if (kind === 'load') e.load++;
          if (where === 'main') e.main++;
          const clean = clip(cleanSentence(sen), 260);
          if (!e.ex || (kind === 'load' && !LOAD.test(e.ex)) || (where === 'main' && e.at !== 'main')) { e.ex = clean; e.at = where; }
        }
      }
    }

    // A start file that names no skill isn't drawn.
    const keep = nodes.map((n, i) => n.k === 'skill' || [...edges.values()].some((e) => e.s === i && e.n > 0));
    const idx = [];
    let c = 0;
    keep.forEach((k, i) => { idx[i] = k ? c++ : -1; });
    const outNodes = nodes.filter((n, i) => keep[i]).map((n) => ({ id: n.id, g: n.g, k: n.k, d: n.d, f: n.f }));
    const links = [...edges.values()].filter((e) => e.n > 0 && keep[e.s] && keep[e.t])
      .map((e) => ({ s: idx[e.s], t: idx[e.t], n: e.n, load: e.load > 0 ? 1 : 0, ex: e.ex, at: e.at, v: SM.PATTERNS.filter((k) => e.v.has(k)) }))
      .sort((x, y) => x.s - y.s || x.t - y.t);
    const linked = new Set();
    links.forEach((l) => { linked.add(l.s); linked.add(l.t); });
    return {
      v: 1, built: new Date().toISOString().slice(0, 10), groups, nodes: outNodes, links,
      stats: { files: p.files.length, capped: p.capped, via, prefixes: [...prefixes].sort(), falseHits, lonely: outNodes.filter((n, i) => n.k === 'skill' && !linked.has(i)).map((n) => n.id) },
    };
  }
  SM.scan = scan;

  async function pool(n, k, fn) {
    let next = 0;
    const run = async () => { while (next < n) { const i = next++; await fn(i); } };
    await Promise.all(Array.from({ length: Math.min(k, n) }, run));
  }

  // From a source to a map. list: every path in the source. read(path) gives a file's text.
  // opts: { rules, src, name, parallel, onProgress(done, total) }. Rules come from skill-map.json at the top when none are given.
  SM.build = async function (list, read, opts) {
    opts = opts || {};
    const paths = list.map(norm);
    let rules = opts.rules || null, rulesFrom = opts.rules ? 'given' : null;
    if (!rules && paths.includes('skill-map.json')) {
      const raw = await read('skill-map.json');
      try { rules = JSON.parse(raw); rulesFrom = 'skill-map.json'; } catch (e) { const err = new Error('skill-map.json is not valid JSON: ' + e.message); err.code = 'BAD_RULES'; throw err; }
    }
    if (rules && (typeof rules !== 'object' || Array.isArray(rules))) {
      const err = new Error('The rules must be one JSON object, such as {"ignore": ["review"]}.');
      err.code = 'BAD_RULES';
      throw err;
    }
    const p = plan(paths, rules);
    if (!p.skills.length) { const err = new Error('No skills found. A skill is a folder with a SKILL.md file in it.'); err.code = 'NO_SKILLS'; throw err; }
    const files = new Array(p.files.length);
    let done = 0;
    await pool(p.files.length, opts.parallel || 8, async (i) => {
      let text = '';
      try { text = await read(p.files[i]); } catch (e) { text = ''; }
      files[i] = { path: p.files[i], text };
      done++;
      if (opts.onProgress) opts.onProgress(done, p.files.length);
    });
    const map = scan(files, { rules, plan: p, name: opts.name });
    map.src = opts.src || null;
    map.rules = rulesFrom;
    return map;
  };

  // "owner/name", or a github.com link to a repo, a branch or a folder. Returns { owner, name, ref, path } or null.
  SM.parseRepo = function (s) {
    s = String(s || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '').replace(/\.git$/, '');
    let m = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/(?:tree|blob)\/([^/]+)(?:\/(.+))?)?$/i);
    if (!m) { const b = s.match(/^([\w.-]+)\/([\w.-]+)$/); if (b) m = [b[0], b[1], b[2]]; }
    if (!m) return null;
    return { owner: m[1], name: m[2], ref: m[3] || '', path: (m[4] || '').replace(/(^|\/)SKILL\.md$/i, '').replace(/\/+$/, '') };
  };

  function ghError(r, spec) {
    const left = r.headers.get('x-ratelimit-remaining'), reset = +r.headers.get('x-ratelimit-reset');
    let msg = 'GitHub answered ' + r.status + ' for ' + spec.owner + '/' + spec.name + '.';
    if ((r.status === 403 || r.status === 429) && left === '0') {
      const when = reset ? new Date(reset * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'an hour';
      msg = 'GitHub allows 60 lookups an hour without signing in. Try again after ' + when + '.';
    } else if (r.status === 404) msg = "Can't find github.com/" + spec.owner + '/' + spec.name + (spec.ref ? ' at ' + spec.ref : '') + '. Check the name. A private repo needs the Node script and a GitHub token.';
    const err = new Error(msg);
    err.code = 'GITHUB_' + r.status;
    return err;
  }

  // A public GitHub repo as a source: one lookup for the file list, then each file from raw.githubusercontent.com.
  // opts: { fetch, headers, rawHeaders }. Returns { list, read, src }.
  SM.github = async function (spec, opts) {
    opts = opts || {};
    const f = opts.fetch || root.fetch.bind(root);
    const ref = spec.ref || 'HEAD';
    const r = await f('https://api.github.com/repos/' + spec.owner + '/' + spec.name + '/git/trees/' + encodeURIComponent(ref) + '?recursive=1', { headers: Object.assign({ Accept: 'application/vnd.github+json' }, opts.headers || {}) });
    if (!r.ok) throw ghError(r, spec);
    const tree = await r.json();
    const base = spec.path ? spec.path + '/' : '';
    const list = (tree.tree || []).filter((e) => e.type === 'blob' && e.path.startsWith(base)).map((e) => e.path.slice(base.length));
    const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
    const read = async (p) => {
      const x = await f('https://raw.githubusercontent.com/' + spec.owner + '/' + spec.name + '/' + ref + '/' + enc(base + p), { headers: opts.rawHeaders || {} });
      return x.ok ? x.text() : '';
    };
    return { list, read, src: { repo: spec.owner + '/' + spec.name, ref: spec.ref || '', path: spec.path || '', truncated: !!tree.truncated } };
  };

  // Where a skill's file opens: on GitHub, or on this computer for a folder.
  SM.fileUrl = function (map, f) {
    const s = map.src || {};
    const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
    if (s.repo) return 'https://github.com/' + s.repo + '/blob/' + (s.ref || 'HEAD') + '/' + enc((s.path ? s.path + '/' : '') + f);
    if (s.dir) return 'file:///' + enc(s.dir.replace(/\\/g, '/').replace(/^\/+/, '') + '/' + f);
    return null;
  };
  // A map's name: its GitHub repo, the repo a local clone came from, or the folder's name.
  SM.title = function (map) {
    const s = map.src || {};
    if (s.repo) return s.repo + (s.path ? '/' + s.path : '');
    return s.github || s.name || 'Skills';
  };
  // The live map's address, for a repo on GitHub or a clone of one.
  SM.liveUrl = function (map) {
    const s = map.src || {};
    const repo = s.repo || s.github;
    if (!repo) return SM.LIVE;
    return SM.LIVE + '?repo=' + repo + (s.repo && s.ref ? '&ref=' + encodeURIComponent(s.ref) : '') + (s.repo && s.path ? '&path=' + encodeURIComponent(s.path) : '');
  };
  // The line for a README: the moving image, linked to the live map.
  SM.readme = function (map, image) {
    return '[![Skill map of ' + SM.title(map) + '](' + (image || 'skill-map.svg') + ')](' + SM.liveUrl(map) + ')';
  };
})(typeof window !== 'undefined' ? window : globalThis);
