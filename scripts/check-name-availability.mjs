import { mkdir, writeFile } from 'node:fs/promises';
const urls = [
  'https://registry.npmjs.org/decoupleflow',
  'https://api.github.com/users/DecoupleFlow',
  'https://api.github.com/orgs/DecoupleFlow',
  'https://api.github.com/repos/lyt0310603/DecoupleFlow',
];
const results = await Promise.all(urls.map(async url => {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'DecoupleFlow-name-check', Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    return { url, status: response.status, ...(response.ok ? { name: data.name, type: data.type, html_url: data.html_url, description: data.description } : {}) };
  } catch (error) { return { url, error: error.message }; }
}));
const report = { checked_at: new Date().toISOString(), note: 'A 404 means no public resource was found. It does not guarantee that the name can be registered.', results };
await mkdir(new URL('../docs/verification/', import.meta.url), { recursive: true });
await writeFile(new URL('../docs/verification/name-availability.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (results.some(r => r.error || ![200, 404].includes(r.status))) process.exitCode = 1;
