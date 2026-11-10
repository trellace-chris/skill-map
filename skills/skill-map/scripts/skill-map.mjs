#!/usr/bin/env node
// Skill Map: maps how the skills in a folder or a GitHub repo call each other.
// Writes <name>.html, a map to open in any browser, and <name>.svg, a moving image for a README.
// Needs Node 18 or newer and nothing else. Set GITHUB_TOKEN for a private repo or more than 60 lookups an hour.
// Run with --help for the options.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, '..', 'assets');
const USAGE = 'Usage: node skill-map.mjs <folder | owner/repo | GitHub link> [options]. --help lists the options.';
const HELP = [
  'Usage: node skill-map.mjs <folder | owner/repo | GitHub link> [options]',
  '',
  'Writes <name>.html, a map to open in any browser, and <name>.svg, a moving image for a README.',
  '',
  '  --out <folder>     where to write them (default: this folder)',
  '  --name <name>      file name without the ending (default: skill-map)',
  '  --rules <file>     rules to use instead of the repo\'s skill-map.json',
  '  --only page|image  write just one of the two',
  '',
  'The image:',
  '  --format readme|square|wide  900x940 for a README (default), 1200x1200 for a post, 1200x675 for slides',
  '  --theme dark|light           colours (default: dark)',
  '  --size in|named|out|same     size dots by the skills that link to each (default), every sentence that',
  '                               names it, the skills it names, or one size',
  '  --focus <skill>              light up one skill and play its chains',
  '  --title <text>               title at the top (default: the repo or folder name)',
  '  --show all|linked            every skill, or only those with links (default: only those with links',
  '                               when there are over 60 skills)',
  '  --no-mentions                hand-offs only',
  '  --no-labels                  no skill names',
  '  --still                      no movement',
  '',
  'For a PNG, open the page, click Make an image and choose Download PNG.',
].join('\n');

// The page's own scanner and drawing code, so the map here matches the live page.
export async function engine() {
  if (!globalThis.SkillMap || !globalThis.SkillMap.render) {
    await import(pathToFileURL(path.join(ASSETS, 'scan.js')).href);
    await import(pathToFileURL(path.join(ASSETS, 'draw.js')).href);
  }
  return globalThis.SkillMap;
}

export function parseArgs(argv) {
  const o = { target: null, out: null, name: 'skill-map', rules: null, only: null, still: false, help: false, image: {} };
  const val = (i, flag) => { const v = argv[i + 1]; if (v == null || v.startsWith('--')) throw new Error(flag + ' needs a value. ' + USAGE); return v; };
  const pick = (i, flag, allowed) => { const v = val(i, flag); if (!allowed.includes(v)) throw new Error(flag + ' takes ' + allowed.join(', ') + '.'); return v; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--out') o.out = val(i++, a);
    else if (a === '--name') o.name = val(i++, a).replace(/\.(html|svg)$/i, '');
    else if (a === '--rules') o.rules = val(i++, a);
    else if (a === '--only') o.only = pick(i++, a, ['page', 'image']);
    else if (a === '--still') o.still = true;
    else if (a === '--format') o.image.format = pick(i++, a, ['readme', 'square', 'wide']);
    else if (a === '--theme') o.image.theme = pick(i++, a, ['dark', 'light']);
    else if (a === '--size') o.image.sizeBy = pick(i++, a, ['in', 'named', 'out', 'same']);
    else if (a === '--show') o.image.show = pick(i++, a, ['all', 'linked']);
    else if (a === '--focus') o.image.focus = val(i++, a);
    else if (a === '--title') o.image.title = val(i++, a);
    else if (a === '--no-mentions') o.image.mentions = false;
    else if (a === '--no-labels') o.image.labels = false;
    else if (a.startsWith('--')) throw new Error('Unknown option ' + a + '. ' + USAGE);
    else if (!o.target) o.target = a;
    else throw new Error('One folder or repo at a time. ' + USAGE);
  }
  return o;
}

// Every file under a folder, as paths with forward slashes. Follows linked folders once each,
// since skill folders are often links into another place.
export function listFolder(dir) {
  const out = [], seen = new Set();
  const walk = (d, rel) => {
    let real;
    try { real = fs.realpathSync(d); } catch { return; }
    if (seen.has(real)) return;
    seen.add(real);
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const p = path.join(d, e.name), r = rel ? rel + '/' + e.name : e.name;
      let isDir = e.isDirectory(), isFile = e.isFile();
      if (e.isSymbolicLink()) { try { const st = fs.statSync(p); isDir = st.isDirectory(); isFile = st.isFile(); } catch { continue; } }
      if (isDir) walk(p, r);
      else if (isFile) out.push(r);
    }
  };
  walk(dir, '');
  return out;
}

// The GitHub repo a local clone came from, read from .git/config, so its README line links to its live map.
export function githubOf(dir) {
  let text;
  try { text = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8'); } catch { return null; }
  const origin = text.split(/^\[/m).find((s) => /^remote "origin"\]/.test(s));
  const m = origin && origin.match(/url\s*=\s*(?:https:\/\/(?:[^@/\s]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\s*$/m);
  return m ? m[1] + '/' + m[2] : null;
}

// The page with its code and the map inside, so it opens from disk with no internet.
export function pageHtml(map) {
  const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  let html = fs.readFileSync(path.join(ASSETS, 'index.html'), 'utf8');
  for (const f of ['scan.js', 'draw.js']) {
    const code = safe(fs.readFileSync(path.join(ASSETS, f), 'utf8'));
    html = html.replace('<script src="' + f + '"></script>', () => '<script>\n' + code + '\n</script>');
  }
  return html.replace('<!--MAP-->', () => '<script>window.SKILL_MAP = ' + safe(JSON.stringify(map)) + ';</script>');
}

// What the run found, for the person or agent to check.
export function report(SM, map, written) {
  const s = map.src || {};
  const title = SM.title(map);
  const skills = map.nodes.filter((n) => n.k === 'skill').length;
  const loads = map.links.filter((l) => l.load).length;
  const L = [];
  L.push('Skill Map of ' + title + ': ' + skills + ' skills' + (map.groups.length > 1 ? ' in ' + map.groups.length + ' groups' : '') + ', ' + map.links.length + ' links (' + loads + ' hand off, ' + (map.links.length - loads) + ' mention).');
  const NAMES = { code: 'name in backticks', prefix: 'namespace:name', link: 'Markdown link', slash: '/name', phrase: '"name skill"', alias: 'alias from the rules' };
  L.push('Found by: ' + SM.PATTERNS.map((k) => NAMES[k] + ' ' + map.stats.via[k]).join(', ') + '.');
  if (map.stats.prefixes.length) L.push('Namespaces: ' + map.stats.prefixes.join(', ') + '.');
  if (map.rules) L.push('Rules from ' + map.rules + '.');
  if (map.stats.falseHits) L.push('Left out ' + map.stats.falseHits + (map.stats.falseHits === 1 ? ' sentence' : ' sentences') + ' where a skill name meant something else, such as a column or a label.');
  const lonely = map.stats.lonely;
  if (lonely.length) L.push('No links: ' + lonely.length + ' skills (' + lonely.slice(0, 8).join(', ') + (lonely.length > 8 ? ', …' : '') + ').');
  if (map.stats.capped) L.push('Left out ' + map.stats.capped + ' files past the limit of ' + SM.LIMITS.perSkill + ' per skill or ' + SM.LIMITS.files + ' in all, the deepest in each skill first.');
  if (s.truncated) L.push('GitHub sent only part of the file list, so some skills may be missing.');
  // A sample to check by eye: the busiest links first, then one for each way a link was found.
  const pick = [], seen = new Set();
  const add = (l) => { if (l && !seen.has(l) && pick.length < 8) { seen.add(l); pick.push(l); } };
  const busy = map.links.slice().sort((a, b) => b.n - a.n);
  busy.slice(0, 4).forEach(add);
  SM.PATTERNS.forEach((k) => add(busy.find((l) => l.v.includes(k))));
  busy.forEach(add);
  if (pick.length) {
    L.push('', 'Check these links:');
    pick.forEach((l) => L.push('  ' + map.nodes[l.s].id + ' -> ' + map.nodes[l.t].id + (l.load ? '' : ' (mention)') + ' [' + l.v.join(', ') + ']: "' + l.ex + '"' + (l.at !== 'main' ? ' (in ' + l.at + ')' : '')));
  }
  const ch = SM.chains(map, 3);
  if (ch.length) {
    L.push('', 'Longest chains:');
    ch.forEach((c) => L.push('  ' + [map.links[c[0]].s].concat(c.map((k) => map.links[k].t)).map((i) => map.nodes[i].id).join(' -> ')));
  }
  L.push('');
  written.forEach((f) => L.push(path.basename(f) + ': ' + pathToFileURL(f).href));
  if (written.some((f) => f.endsWith('.svg'))) {
    L.push('', 'README line:', '  ' + SM.readme(map, path.basename(written.find((f) => f.endsWith('.svg')))));
    if (!s.repo && !s.github) L.push('  (This folder has no GitHub address, so the image links to Skill Map itself. Map the repo on GitHub to link its live map.)');
  }
  return L.join('\n');
}

export async function run(argv, io = {}) {
  const log = io.log || console.log;
  const cwd = io.cwd || process.cwd();
  const env = io.env || process.env;
  const o = parseArgs(argv);
  if (o.help) { log(HELP); return null; }
  if (!o.target) throw new Error('Say which folder or repo to map. ' + USAGE);
  const SM = await engine();
  let rules = null;
  if (o.rules) {
    try { rules = JSON.parse(fs.readFileSync(path.resolve(cwd, o.rules), 'utf8')); } catch (e) { throw new Error('Could not read the rules in ' + o.rules + ': ' + e.message); }
  }
  let map;
  const folder = path.resolve(cwd, o.target);
  if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
    const name = path.basename(folder);
    map = await SM.build(listFolder(folder), (p) => fs.promises.readFile(path.join(folder, p), 'utf8'), { rules, name, src: { name, dir: folder, github: githubOf(folder) } });
  } else {
    const spec = SM.parseRepo(o.target);
    if (!spec) throw new Error('No folder at ' + folder + ', and "' + o.target + '" is not a GitHub repo such as owner/repo.');
    const fetchFn = io.fetch || globalThis.fetch;
    if (!fetchFn) throw new Error('This Node is ' + process.version + '. Skill Map needs Node 18 or newer to read GitHub.');
    const token = env.GITHUB_TOKEN || env.GH_TOKEN;
    const src = await SM.github(spec, {
      fetch: fetchFn,
      headers: Object.assign({ 'User-Agent': 'skill-map' }, token ? { Authorization: 'Bearer ' + token } : {}),
      rawHeaders: Object.assign({ 'User-Agent': 'skill-map' }, token ? { Authorization: 'token ' + token } : {}),
    });
    map = await SM.build(src.list, src.read, { rules, name: spec.name, src: src.src });
  }
  if (o.image.focus && !map.nodes.some((n) => n.id === o.image.focus)) {
    const near = map.nodes.map((n) => n.id).filter((id) => id.includes(o.image.focus)).slice(0, 5);
    throw new Error('No skill named ' + o.image.focus + ' in this map.' + (near.length ? ' Close: ' + near.join(', ') + '.' : ''));
  }
  const out = path.resolve(cwd, o.out || '.');
  fs.mkdirSync(out, { recursive: true });
  const written = [];
  if (o.only !== 'image') { const f = path.join(out, o.name + '.html'); fs.writeFileSync(f, pageHtml(map)); written.push(f); }
  if (o.only !== 'page') { const f = path.join(out, o.name + '.svg'); fs.writeFileSync(f, SM.image(map, Object.assign({ animate: !o.still }, o.image))); written.push(f); }
  log(report(SM, map, written));
  return { map, written };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const major = +process.versions.node.split('.')[0];
  if (major < 18) { console.error('This Node is ' + process.version + '. Skill Map needs Node 18 or newer.'); process.exit(1); }
  run(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1); });
}
