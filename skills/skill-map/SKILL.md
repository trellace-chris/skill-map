---
name: skill-map
description: "Map how the skills in a folder or GitHub repo call each other: a circle of every skill with its links and chains, and images for a README or a post. Say map the skills in <folder or repo>."
license: MIT
---

# Skill Map

Draws every skill in a repo on one circle, with a line wherever one skill names another. Hands back a page to explore and a moving SVG for a README. It reads the skill files and nothing else, and no AI runs inside it.

## 1. Pick the target

The person names a folder or a GitHub repo, such as `obra/superpowers` or a github.com link. When they name neither, use the folder you're working in if a SKILL.md sits anywhere inside it, and say which folder you chose. Done when you have one folder path or one repo.

## 2. Build the map

Run this, with the path to this skill's folder:

```
node "<skill folder>/scripts/skill-map.mjs" "<target>" --out "<output folder>"
```

- For a folder, use a new `skill-map` folder beside it, so nothing lands inside the person's repo. For a GitHub repo, use a new `skill-map` folder in the folder you're working in.
- A private GitHub repo needs a `GITHUB_TOKEN` set first, or a local clone as the target. The token also lifts GitHub's limit of 60 lookups an hour.
- When `node --version` fails or shows a version below 18, go to "Without Node" below.

The script prints what it found and a `file:///` link for each file it wrote. Done when those links print.

## 3. Check the links

Repos name their skills in different ways. The report's "Found by" line counts each way the script looks for. It turns on a namespace, such as `superpowers:` in `superpowers:writing-plans`, once that word comes before two or more skill names.

1. Read each link under "Check these links". Each one shows the sentence it came from.
2. Open the SKILL.md of two or three skills listed under "No links". Look for how they name other skills.
3. When a sample link is wrong, or the skills name each other in a way the report counts as 0, write `skill-map.json` at the top of the target with the rules below, then run step 2 again. For someone else's repo on GitHub, write the file in the output folder and add `--rules "<file>"`.

| Key | What it does | Example |
|---|---|---|
| `exclude` | Leaves out paths, such as examples and templates | `["examples", "**/templates"]` |
| `ignore` | Skill names that never count as a link, for a name that is also a common word | `["review"]` |
| `aliases` | Other words that mean a skill | `{"the writer": "writing"}` |
| `prefixes` | A namespace written before skill names | `["superpowers"]` |
| `off` | Ways of naming to skip: `code`, `prefix`, `link`, `slash`, `phrase` | `["slash"]` |
| `start` | Files read at the start of every session, such as `AGENTS.md`, each shown as its own dot | `["AGENTS.md"]` |

Stop after two rounds. Done when every sample link is right and each skill under "No links" names no other skill.

## 4. Hand back

Give the person:

- the page's link from the report. Hovering a skill lights up its chain, and clicking it shows the sentence behind each link.
- the counts and the longest chains from the report.
- for their own repo, the README line from the report. Offer to copy `skill-map.svg` to the top of their repo and add the line to their README, and change their repo only once they say yes.

## Other images

When the person wants a different image, such as a square for LinkedIn, a light one for slides, or one skill's chains lit up, point them to the page's "Make an image" button. It previews each choice and saves a moving SVG or a still PNG. For an SVG from here, run step 2 again with `--only image` and the flags from `--help`, such as `--format square --theme light --focus <skill>`.

## Without Node

For a public GitHub repo, give the person `https://trellace-chris.github.io/skill-map/?repo=<owner>/<name>`. For a folder, give them `https://trellace-chris.github.io/skill-map/` and tell them to click "Pick a folder". The page reads the files in their browser, then offers the image and the README line.
