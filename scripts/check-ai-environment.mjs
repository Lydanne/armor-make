import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = resolve(root, '.agents/skills');
const manifest = JSON.parse(await readFile(resolve(skillRoot, 'sources.json'), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const blobHash = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

function childPath(parent, name) {
  assert.equal(typeof name, 'string', 'Manifest path must be a string');
  assert.ok(name && !isAbsolute(name), `Invalid manifest path: ${name}`);
  const path = resolve(parent, name);
  const rel = relative(parent, path);
  assert.ok(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), `Escaping manifest path: ${name}`);
  return path;
}

async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    assert.equal(entry.isSymbolicLink(), false, `Unexpected symlink: ${path}`);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unexpected file type: ${path}`);
  }
  return files.sort();
}

assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.source.repo, 'mattpocock/skills');
assert.match(manifest.source.ref, /^[0-9a-f]{40}$/);
assert.ok(Array.isArray(manifest.skills) && manifest.skills.length > 0);
const names = new Set();
let checkedFiles = 0;
for (const skill of manifest.skills) {
  assert.match(skill.name, /^[a-z0-9-]+$/);
  assert.equal(names.has(skill.name), false, `Duplicate skill: ${skill.name}`);
  names.add(skill.name);
  assert.ok(skill.upstreamPath.startsWith('skills/'));
  const directory = childPath(skillRoot, skill.name);
  assert.equal((await lstat(directory)).isSymbolicLink(), false);
  const expected = skill.files.map(file => childPath(directory, file.path)).sort();
  assert.deepEqual(await filesIn(directory), expected, `Skill files changed: ${skill.name}`);
  for (const file of skill.files) {
    const path = childPath(directory, file.path);
    const bytes = await readFile(path);
    assert.equal(sha256(bytes), file.sha256, `SHA-256 mismatch: ${path}`);
    assert.equal(blobHash(bytes), file.upstreamBlob, `Upstream blob mismatch: ${path}`);
    checkedFiles++;
  }
  const text = await readFile(resolve(directory, 'SKILL.md'), 'utf8');
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  assert.ok(frontmatter, `Missing skill frontmatter: ${skill.name}`);
  assert.match(frontmatter, new RegExp(`^name:\\s*["']?${skill.name}["']?\\s*$`, 'm'));
  assert.match(frontmatter, /^description:\s*\S.+$/m);
}
for (const entry of await readdir(skillRoot, { withFileTypes: true })) {
  if (entry.isDirectory()) assert.ok(names.has(entry.name), `Unlisted skill: ${entry.name}`);
  assert.equal(entry.isSymbolicLink(), false, `Unexpected skill-root symlink: ${entry.name}`);
}

const licensePath = childPath(root, manifest.license.path);
const license = await readFile(licensePath);
assert.equal(sha256(license), manifest.license.sha256);
assert.equal(blobHash(license), manifest.license.upstreamBlob);
assert.match(license.toString('utf8'), /MIT License/);

const documents = [
  resolve(root, 'AGENTS.md'), resolve(root, 'GLOSSARY.md'), resolve(root, 'README.md'),
  ...await filesIn(resolve(root, 'docs')), ...await filesIn(skillRoot),
].filter(path => path.endsWith('.md'));
for (const path of documents) {
  const text = await readFile(path, 'utf8');
  const withoutFences = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  for (const match of withoutFences.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].replace(/^<|>$/g, '').trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    target = target.split('#')[0];
    if (!target) continue;
    const destination = resolve(dirname(path), decodeURIComponent(target));
    const rel = relative(root, destination);
    assert.ok(rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), `Link escapes repo: ${path}: ${target}`);
    assert.ok(await stat(destination), `Missing local link: ${path}: ${target}`);
  }
}

process.stdout.write(`AI environment verified: ${names.size} pinned skills, ${checkedFiles} upstream files, license and ${documents.length} Markdown documents.\n`);
