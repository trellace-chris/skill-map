// Redraws the README gallery from each repo on GitHub. Run from the repo root: npm run gallery
import { run } from '../skills/skill-map/scripts/skill-map.mjs';

const REPOS = ['obra/superpowers', 'mattpocock/skills', 'coreyhaines31/marketingskills', 'addyosmani/agent-skills', 'K-Dense-AI/scientific-agent-skills'];
for (const repo of REPOS) {
  await run([repo, '--out', 'gallery', '--name', repo.replace('/', '-').toLowerCase(), '--only', 'image'], { log: (s) => console.log(s.split('\n')[0]) });
}
