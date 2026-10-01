import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { expect, it } from 'vitest';
import { buildSkillBundle, compileMarkdown, hashText } from '../src/domain/compiler';
import { createDemo, DEMO_IDS } from '../src/domain/demos';
import { createTemplate } from '../src/domain/templates';
import { importProject } from '../src/domain/types';
import { validateMachine } from '../src/domain/validate';

it.each(DEMO_IDS)('%s demo imports, localizes, and ships the same validated definition in every Skill ZIP', async id => {
  for (const language of ['en', 'zh'] as const) {
    const project = createDemo(id, language);
    const folder = new URL(`../examples/demos/${id}/`, import.meta.url);
    const read = (path: string) => readFile(new URL(path, folder));
    expect(validateMachine(project.machine)).toEqual([]);
    expect(importProject(JSON.parse((await read(`project.${language}.decoupleflow.json`)).toString()))).toEqual(project);
    expect(createTemplate(id, language)).toEqual(project);
    expect((await read(`state-machine.${language}.md`)).toString()).toBe(compileMarkdown(project.machine, language));
    const bundle = await buildSkillBundle(project.machine, language);
    if (language === 'en') expect(JSON.stringify(project.machine)).not.toMatch(/[\u3400-\u9fff]/);
    for (const [target, directory] of [['codex', '.agents/skills'], ['claude', '.claude/skills'], ['copilot', '.github/skills']]) {
      const files = unzipSync(await read(`${target}.${language}.zip`));
      const prefix = `${directory}/${bundle.skillName}/`;
      expect(Object.keys(files).sort()).toEqual(Object.keys(bundle.files).map(name => prefix + name).sort());
      const manifest = JSON.parse(strFromU8(files[prefix + 'decoupleflow-manifest.json']));
      expect(manifest.language).toBe(language);
      expect(manifest.semanticHash).toBe(bundle.semanticHash);
      for (const [name, expected] of Object.entries(bundle.files)) {
        const actual = strFromU8(files[prefix + name]);
        // TSX and Vite serialize runtime functions differently. Check portable
        // code against its own manifest; compare the authored definition and
        // user-facing documents byte for byte across those build pipelines.
        if (!name.startsWith('scripts/') && name !== 'decoupleflow-manifest.json') expect(actual, `${target}/${language}/${name}`).toBe(expected);
        if (manifest.files[name]) expect(await hashText(actual)).toBe(manifest.files[name]);
      }
    }
  }
});
