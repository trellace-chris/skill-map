// Tests for Skill Map. Run from the repo root: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engine, githubOf, listFolder, pageHtml, parseArgs, run } from '../skills/skill-map/scripts/skill-map.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TRIP = path.join(HERE, 'fixtures', 'trip');
const SM = await engine();
const readFrom = (dir) => (p) => fs.promises.readFile(path.join(dir, p), 'utf8');
const mapOf = (dir, opts = {}) => SM.build(listFolder(dir), readFrom(dir), { name: path.basename(dir), src: { name: path.basename(dir) }, ...opts });
const linkList = (map) => map.links.map((l) => map.nodes[l.s].id + '>' + map.nodes[l.t].id + (l.load ? '' : ' (mention)')).sort();
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'skill-map-'));

test('frontmatter reads plain, quoted and folded values', () => {
  const { fm, body } = SM.frontmatter('---\nname: a\ndescription: >\n  one\n  two\nq: "say \\"hi\\""\ns: \'it\'\'s\'\nlong: first\n  second\nmetadata:\n  key: v\n---\nBody');
  assert.equal(fm.name, 'a');
  assert.equal(fm.description, 'one two');
  assert.equal(fm.q, 'say "hi"');
  assert.equal(fm.s, "it's");
  assert.equal(fm.long, 'first second');
  assert.equal(body, 'Body');
  assert.deepEqual(SM.frontmatter('no frontmatter').fm, {});
});

test('a skill is a folder with SKILL.md, one inside another is part of it, and the deepest files are capped first', () => {
  const p = SM.plan(['a/SKILL.md', 'a/ex/SKILL.md', 'a/ref.md', 'node_modules/x/SKILL.md', 'b/SKILL.md', 'b/notes.txt', 'README.md', 'skip/c/SKILL.md'], { exclude: ['skip'] });
  assert.deepEqual(p.skills, ['a', 'b']);
  assert.deepEqual(p.files, ['a/SKILL.md', 'b/SKILL.md', 'a/ref.md', 'a/ex/SKILL.md']);
  const many = ['big/SKILL.md'];
  for (let i = 0; i < 70; i++) many.push('big/deep/x/f' + i + '.md');
  many.push('big/top.md');
  const q = SM.plan(many);
  assert.equal(q.files.length, 1 + SM.LIMITS.perSkill);
  assert.ok(q.files.includes('big/top.md'));
  assert.equal(q.capped, 71 - SM.LIMITS.perSkill);
});

test('every way of naming a skill is found, and a name that means something else is left out', async () => {
  const map = await mapOf(TRIP);
  assert.deepEqual(map.groups, ['skills', 'tools']);
  assert.deepEqual(map.nodes.map((n) => n.id), ['book-flight', 'budget', 'pack-bag', 'plan-trip', 'weather-check', 'convert-currency']);
  assert.equal(map.nodes[0].d, 'Find and book a flight for the dates in the plan.');
  assert.deepEqual(linkList(map), [
    'book-flight>pack-bag', 'book-flight>weather-check',
    'budget>convert-currency (mention)', 'budget>pack-bag',
    'convert-currency>budget (mention)',
    'plan-trip>book-flight', 'plan-trip>budget', 'plan-trip>pack-bag', 'plan-trip>weather-check (mention)',
    'weather-check>book-flight (mention)', 'weather-check>plan-trip',
  ]);
  assert.deepEqual(map.stats.via, { code: 6, prefix: 2, link: 1, slash: 1, phrase: 2, alias: 0 });
  assert.deepEqual(map.stats.prefixes, ['trip']);
  assert.equal(map.stats.falseHits, 1);
  const fares = map.links.find((l) => map.nodes[l.s].id === 'book-flight' && map.nodes[l.t].id === 'weather-check');
  assert.equal(fares.at, 'references/fares.md');
  assert.deepEqual(fares.v, ['phrase']);
  // Each link keeps only these keys, so nothing else reaches a page.
  assert.deepEqual(Object.keys(map.links[0]), ['s', 't', 'n', 'load', 'ex', 'at', 'v']);
  assert.deepEqual(Object.keys(map.nodes[0]), ['id', 'g', 'k', 'd', 'f']);
});

test('the rules turn patterns off, ignore names, add aliases and start files, and leave out paths', async () => {
  const off = await mapOf(TRIP, { rules: { off: ['phrase'], ignore: ['budget'] } });
  // An ignored name is never a link's target. The skill's own links still count.
  assert.ok(!linkList(off).some((l) => l.split('>')[1].startsWith('budget')));
  assert.ok(linkList(off).includes('budget>pack-bag'));
  assert.equal(off.stats.via.phrase, 0);
  const more = await mapOf(TRIP, { rules: { aliases: { 'the packer': 'pack-bag' }, start: ['AGENTS.md'], exclude: ['tools'] } });
  assert.ok(!more.nodes.some((n) => n.id === 'convert-currency'));
  const start = more.nodes.find((n) => n.k === 'start');
  assert.equal(start.id, 'AGENTS.md');
  assert.ok(linkList(more).includes('AGENTS.md>plan-trip (mention)'));
  const packer = more.links.find((l) => more.nodes[l.s].id === 'plan-trip' && more.nodes[l.t].id === 'pack-bag');
  assert.deepEqual(packer.v, ['link', 'alias']);
  // A start file that names no skill isn't drawn.
  const none = await mapOf(TRIP, { rules: { start: ['AGENTS.md'], ignore: ['plan-trip'] } });
  assert.ok(!none.nodes.some((n) => n.k === 'start'));
});

test('a kind of skill, a web address and a namespace used once are not links', () => {
  const files = [
    { path: 'pdf/SKILL.md', text: '---\nname: pdf\n---\nRead PDFs.' },
    { path: 'pricing/SKILL.md', text: '---\nname: pricing\n---\nSet prices.' },
    { path: 'site/SKILL.md', text: '---\nname: site\n---\nWrite a PDF skill test. Pages: Home (/), Pricing (/pricing). See note:pdf for more.' },
  ];
  const map = SM.scan(files);
  assert.deepEqual(map.links, []);
  assert.deepEqual(map.stats.prefixes, []);
});

test('a name counts in the case the skill is written in', () => {
  const map = SM.scan([
    { path: 'PDF/SKILL.md', text: '---\nname: PDF\n---\nx' },
    { path: 'docx/SKILL.md', text: '---\nname: docx\n---\nx' },
    { path: 'a/SKILL.md', text: '---\nname: a\n---\nUse `PDF` here. Then the PDF skill. Not `DOCX`, and not a DOCX skill.' },
  ]);
  assert.deepEqual(linkList(map), ['a>PDF']);
});

test("a pattern from someone else's rules file can't stall the scan, and odd rules don't crash it", () => {
  const paths = ['s/SKILL.md', 'x'.repeat(60) + '/SKILL.md'];
  const t0 = Date.now();
  const p = SM.plan(paths, { exclude: ['*'.repeat(40) + 'y', '**/' + '*a'.repeat(20) + 'z'] });
  assert.ok(Date.now() - t0 < 500);
  assert.equal(p.skills.length, 2);
  assert.deepEqual(SM.plan(['a/SKILL.md', 'ex/b/SKILL.md', 'c/templates/d/SKILL.md'], { exclude: ['ex', '**/templates'] }).skills, ['a']);
  const map = SM.scan([{ path: 'a/SKILL.md', text: 'Use `b`.' }, { path: 'b/SKILL.md', text: 'x' }], { rules: { ignore: 'b', off: null, aliases: ['bad'], prefixes: 7 } });
  assert.deepEqual(map.links, []);
});

test('rules that are not one object stop with a clear message', async () => {
  await assert.rejects(SM.build(['a/SKILL.md'], async () => '', { rules: ['ignore'] }), (e) => e.code === 'BAD_RULES' && /one JSON object/.test(e.message));
});

test('two skills with one name each keep a dot, and a link goes to the one in the same group', () => {
  const map = SM.scan([
    { path: 'p1/review/SKILL.md', text: '---\nname: review\n---\nx' },
    { path: 'p1/plan/SKILL.md', text: '---\nname: plan\n---\nThen use `review`.' },
    { path: 'p2/review/SKILL.md', text: '---\nname: review\n---\nx' },
  ]);
  assert.deepEqual(map.nodes.map((n) => n.id), ['plan', 'review (p1)', 'review (p2)']);
  assert.deepEqual(linkList(map), ['plan>review (p1)']);
});

test('a GitHub link or owner/name is read, and anything else is not', () => {
  assert.deepEqual(SM.parseRepo('obra/superpowers'), { owner: 'obra', name: 'superpowers', ref: '', path: '' });
  assert.deepEqual(SM.parseRepo('https://github.com/a/b.git'), { owner: 'a', name: 'b', ref: '', path: '' });
  assert.deepEqual(SM.parseRepo('github.com/a/b/tree/dev/plugins/x/'), { owner: 'a', name: 'b', ref: 'dev', path: 'plugins/x' });
  assert.deepEqual(SM.parseRepo('https://github.com/a/b/blob/main/skills/s/SKILL.md'), { owner: 'a', name: 'b', ref: 'main', path: 'skills/s' });
  assert.equal(SM.parseRepo('not a repo'), null);
  assert.equal(SM.parseRepo('https://gitlab.com/a/b'), null);
});

// A stand-in for GitHub that serves the travel skills, counting what it was asked.
function fakeGitHub(dir, opts = {}) {
  const files = listFolder(dir);
  const asked = [];
  const f = async (url, init) => {
    asked.push([url, init && init.headers]);
    if (url.startsWith('https://api.github.com/')) {
      if (opts.status) return new Response('{}', { status: opts.status, headers: opts.headers || {} });
      return new Response(JSON.stringify({ tree: files.map((p) => ({ path: (opts.base || '') + p, type: 'blob' })).concat([{ path: 'skills', type: 'tree' }]), truncated: false }), { status: 200 });
    }
    const m = url.match(/^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.+)$/);
    const p = decodeURIComponent(m[1]).slice((opts.base || '').length);
    return fs.existsSync(path.join(dir, p)) ? new Response(fs.readFileSync(path.join(dir, p), 'utf8')) : new Response('', { status: 404 });
  };
  return { f, asked };
}

test('a GitHub repo maps the same as the folder, with one lookup for the file list', async () => {
  const gh = fakeGitHub(TRIP, { base: 'packs/trip/' });
  const src = await SM.github({ owner: 'o', name: 'n', ref: '', path: 'packs/trip' }, { fetch: gh.f, headers: { 'User-Agent': 'test' } });
  const map = await SM.build(src.list, src.read, { src: src.src, name: 'n' });
  assert.deepEqual(linkList(map), linkList(await mapOf(TRIP)));
  assert.equal(gh.asked.filter(([u]) => u.startsWith('https://api.github.com/')).length, 1);
  assert.equal(gh.asked[0][1]['User-Agent'], 'test');
  assert.ok(gh.asked.some(([u]) => u === 'https://raw.githubusercontent.com/o/n/HEAD/packs/trip/skills/plan-trip/SKILL.md'));
  assert.equal(SM.fileUrl(map, 'skills/plan-trip/SKILL.md'), 'https://github.com/o/n/blob/HEAD/packs/trip/skills/plan-trip/SKILL.md');
  assert.equal(SM.liveUrl(map), SM.LIVE + '?repo=o/n&path=packs%2Ftrip');
  assert.equal(SM.readme(map), '[![Skill map of o/n/packs/trip](skill-map.svg)](' + SM.LIVE + '?repo=o/n&path=packs%2Ftrip)');
});

test('GitHub errors say what to do', async () => {
  const reset = Math.floor(Date.now() / 1000) + 600;
  const limited = fakeGitHub(TRIP, { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } });
  await assert.rejects(SM.github({ owner: 'o', name: 'n' }, { fetch: limited.f }), /60 lookups an hour/);
  const missing = fakeGitHub(TRIP, { status: 404 });
  await assert.rejects(SM.github({ owner: 'o', name: 'n' }, { fetch: missing.f }), (e) => e.code === 'GITHUB_404' && /Check the name/.test(e.message));
});

test('rules come from skill-map.json in the source, and a bad file or no skills stop with a clear message', async () => {
  const dir = tmp();
  try {
    fs.cpSync(TRIP, dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'skill-map.json'), JSON.stringify({ exclude: ['tools'] }));
    const map = await mapOf(dir);
    assert.equal(map.rules, 'skill-map.json');
    assert.ok(!map.nodes.some((n) => n.id === 'convert-currency'));
    fs.writeFileSync(path.join(dir, 'skill-map.json'), '{ nope');
    await assert.rejects(mapOf(dir), (e) => e.code === 'BAD_RULES');
    await assert.rejects(SM.build(['README.md'], async () => ''), (e) => e.code === 'NO_SKILLS');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// Every animation's key times start at 0, end at 1, never go back, and match its values.
function checkAnimations(svg) {
  let n = 0;
  for (const m of svg.matchAll(/<(animate|animateMotion)\b([^>]*)\/>/g)) {
    n++;
    const attr = (k) => (m[2].match(new RegExp(' ' + k + '="([^"]*)"')) || [])[1];
    const kt = attr('keyTimes').split(';').map(Number);
    assert.equal(kt[0], 0); assert.equal(kt[kt.length - 1], 1);
    kt.forEach((v, i) => { assert.ok(v >= 0 && v <= 1); if (i) assert.ok(v >= kt[i - 1]); });
    const vals = (attr('values') || attr('keyPoints')).split(';');
    assert.equal(vals.length, kt.length);
  }
  return n;
}

test('the image is small, moves only when asked, and its animations are well formed', async () => {
  const map = await mapOf(TRIP);
  const moving = SM.image(map), still = SM.image(map, { animate: false });
  assert.ok(moving.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(!/NaN|undefined/.test(moving));
  assert.ok(checkAnimations(moving) > 0);
  assert.equal(checkAnimations(still), 0);
  assert.ok(moving.length < 100000);
  assert.ok(moving.includes('6 skills, 11 links'));
  // The same map draws the same way every time.
  assert.equal(SM.image(map), moving);
});

// The default README image is locked. It matched the images made before the image options were added, apart from
// the group names' font size moving into each tag. To accept a change on purpose: UPDATE_GOLDEN=1 node --test tests
test('the default README image looks the same as before', async () => {
  const golden = path.join(HERE, 'fixtures', 'trip-default.svg');
  const now = SM.image(await mapOf(TRIP));
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(golden, now);
  assert.equal(now, fs.readFileSync(golden, 'utf8'));
});

test('image options change the size, colours, dots, lines, names and the lit skill', async () => {
  const map = await mapOf(TRIP);
  const viewBox = (svg) => svg.match(/viewBox="([^"]+)"/)[1];
  assert.equal(viewBox(SM.image(map, { format: 'square' })), '0 0 1200 1200');
  assert.equal(viewBox(SM.image(map, { format: 'wide' })), '0 0 1200 675');
  assert.ok(SM.image(map, { theme: 'light' }).includes('fill="#ffffff"'));
  assert.ok(!SM.image(map, { labels: false }).includes('class="sm-lab'));
  const handoffs = SM.image(map, { mentions: false });
  assert.ok(!handoffs.includes('class="sm-e m"') && handoffs.includes('Hand-offs only.') && !handoffs.includes('>Mentions<'));
  // Each way of sizing gives the busiest skill its own size.
  const radius = (svg, id) => { const g = svg.split('<g class="sm-n"').find((s) => s.includes('>' + id + '<')); return +g.match(/<circle[^>]*r="([\d.]+)"[^>]*\/>\s*<circle[^>]*r="([\d.]+)"/)[2]; };
  const sizes = ['in', 'named', 'out', 'same'].map((by) => radius(SM.image(map, { sizeBy: by, animate: false }), 'book-flight'));
  assert.equal(new Set(sizes).size, 4);
  assert.equal(sizes[3], 4);
  // A lit skill plays its own chain, and the still PNG version has square corners.
  const lit = SM.image(map, { focus: 'weather-check' });
  assert.ok(lit.includes('The chains from weather-check.') && lit.includes('"sm-e h1"') && lit.includes('>Its chain<'));
  assert.ok(checkAnimations(lit) > 0);
  const png = SM.image(map, { focus: 'weather-check', animate: false, png: true });
  assert.equal(checkAnimations(png), 0);
  assert.ok(!png.includes('rx="14"'));
  assert.ok(SM.image(map, { title: 'My <trip>' }).includes('>My &lt;trip&gt;<'));
  // In every format the labels start below the subtitle, whose baseline is at 61.
  for (const [name, f] of Object.entries(SM.FORMATS)) assert.ok(f.top >= 64 * f.k, name + ' leaves room for the title');
});

test('a lit skill shows its chain step by step, and the skills that link to it', async () => {
  const map = await mapOf(TRIP);
  const i = map.nodes.findIndex((n) => n.id === 'weather-check');
  const r = SM.reach(map, i);
  assert.equal(r.hop.get(map.nodes.findIndex((n) => n.id === 'plan-trip')), 1);
  assert.equal(r.hop.get(map.nodes.findIndex((n) => n.id === 'book-flight')), 2);
  assert.deepEqual(SM.longestChain(map, i).map((k) => map.nodes[k].id), ['weather-check', 'plan-trip', 'book-flight', 'pack-bag']);
  const svg = SM.render(map, { W: 800, H: 700, focus: i }).svg;
  assert.ok(svg.includes('"sm-e h1"') && svg.includes('"sm-e h2"') && svg.includes('"sm-e m in"'));
  assert.ok(svg.includes('sm-lab on') && svg.includes('sm-lab dim'));
});

test('a big repo shows only its skills with links, renumbered', () => {
  const files = [];
  for (let i = 0; i < SM.CROWDED + 5; i++) files.push({ path: 's' + i + '/SKILL.md', text: '---\nname: s' + i + '\n---\n' + (i < 3 ? 'Then use `s' + (i + 1) + '`.' : 'x') });
  const map = SM.scan(files);
  assert.ok(SM.crowded(map));
  const small = SM.linkedOnly(map);
  assert.deepEqual(small.nodes.map((n) => n.id), ['s0', 's1', 's2', 's3']);
  assert.deepEqual(small.links.map((l) => [l.s, l.t]), [[0, 1], [1, 2], [2, 3]]);
  assert.match(SM.image(map), /Showing the 4 with links/);
  assert.equal((SM.image(map, { show: 'all' }).match(/class="sm-n"/g) || []).length, SM.CROWDED + 5);
  // A lit skill with no links brings back every skill rather than vanish.
  const lone = SM.image(map, { focus: 's40' });
  assert.ok(lone.includes('The chains from s40.') && lone.includes('>s40<'));
  assert.equal((lone.match(/class="sm-n"/g) || []).length, SM.CROWDED + 5);
  // A big repo with no links at all shows every skill rather than none.
  const none = SM.scan(files.map((f) => ({ path: f.path, text: '---\nname: ' + f.path.split('/')[0] + '\n---\nx' })));
  assert.ok(!SM.crowded(none));
  assert.equal((SM.image(none).match(/class="sm-n"/g) || []).length, SM.CROWDED + 5);
});

test('the Node script writes a page that needs no other file and an image, and reports what it found', async () => {
  const out = tmp(), lines = [];
  try {
    const r = await run([TRIP, '--out', out, '--name', 'trip'], { log: (s) => lines.push(s) });
    assert.deepEqual(r.written.map((f) => path.basename(f)), ['trip.html', 'trip.svg']);
    const html = fs.readFileSync(path.join(out, 'trip.html'), 'utf8');
    assert.ok(!html.includes('<script src='));
    assert.ok(html.includes('window.SKILL_MAP = {'));
    const text = lines.join('\n');
    assert.match(text, /^Skill Map of trip: 6 skills in 2 groups, 11 links \(7 hand off, 4 mention\)\./);
    assert.match(text, /Found by: name in backticks 6, namespace:name 2, Markdown link 1, \/name 1, "name skill" 2/);
    assert.match(text, /Check these links:/);
    assert.match(text, /README line:\n {2}\[!\[Skill map of trip\]\(trip\.svg\)\]/);
    lines.length = 0;
    const img = await run([TRIP, '--out', out, '--name', 'still', '--only', 'image', '--still'], { log: (s) => lines.push(s) });
    assert.deepEqual(img.written.map((f) => path.basename(f)), ['still.svg']);
    assert.ok(!fs.readFileSync(img.written[0], 'utf8').includes('animate'));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('a local clone links its README line to its live map, from the GitHub address in .git/config', async () => {
  const dir = tmp(), lines = [];
  try {
    fs.cpSync(TRIP, dir, { recursive: true });
    fs.mkdirSync(path.join(dir, '.git'));
    const cfg = (url) => fs.writeFileSync(path.join(dir, '.git', 'config'), '[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://github.com/other/fork.git\n[remote "origin"]\n\turl = ' + url + '\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n');
    for (const url of ['https://github.com/ann/trip-skills.git', 'git@github.com:ann/trip-skills.git', 'https://token@github.com/ann/trip-skills', 'ssh://git@github.com/ann/trip-skills.git']) { cfg(url); assert.equal(githubOf(dir), 'ann/trip-skills', url); }
    cfg('https://gitlab.com/ann/trip-skills.git');
    assert.equal(githubOf(dir), null);
    cfg('git@github.com:ann/trip-skills.git');
    await run([dir, '--out', path.join(dir, 'out'), '--only', 'image'], { log: (s) => lines.push(s) });
    assert.match(lines.join('\n'), /\[!\[Skill map of ann\/trip-skills\]\(skill-map\.svg\)\]\(https:\/\/trellace-chris\.github\.io\/skill-map\/\?repo=ann\/trip-skills\)/);
    assert.match(fs.readFileSync(path.join(dir, 'out', 'skill-map.svg'), 'utf8'), />ann\/trip-skills</);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the Node script checks its options and its target', async () => {
  assert.throws(() => parseArgs(['x', '--only', 'both']), /--only takes page, image/);
  assert.throws(() => parseArgs(['x', '--size', 'big']), /--size takes in, named, out, same/);
  assert.deepEqual(parseArgs(['x', '--format', 'wide', '--theme', 'light', '--size', 'named', '--focus', 'a', '--no-mentions', '--no-labels', '--show', 'all', '--title', 'T']).image,
    { format: 'wide', theme: 'light', sizeBy: 'named', focus: 'a', mentions: false, labels: false, show: 'all', title: 'T' });
  await assert.rejects(run([TRIP, '--focus', 'plan', '--out', os.tmpdir(), '--only', 'image'], { log: () => {} }), /No skill named plan in this map\. Close: plan-trip\./);
  assert.throws(() => parseArgs(['x', '--out']), /needs a value/);
  assert.throws(() => parseArgs(['x', '--wat']), /Unknown option/);
  await assert.rejects(run([], { log: () => {} }), /Say which folder or repo/);
  await assert.rejects(run(['./no/such/folder here'], { log: () => {} }), /is not a GitHub repo/);
});

test('text from a skill cannot break out of the page', () => {
  const map = SM.scan([{ path: 'x/SKILL.md', text: '---\nname: x\ndescription: "</script><script>alert(1)</script><!--"\n---\nHi' }]);
  const html = pageHtml(map);
  const data = html.slice(html.indexOf('window.SKILL_MAP'));
  assert.ok(!data.slice(0, data.indexOf(';</script>')).includes('</script>'));
  assert.ok(!SM.image(map).includes('<script'));
});
