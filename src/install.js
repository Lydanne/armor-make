import { access, chmod, link, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { entryExists, getAdapter } from './config.js';
import { isManagedWrapper, resolveProgram, wrapperMarker } from './commands.js';

const cliPath = fileURLToPath(new URL('../bin/armor-make.js', import.meta.url));
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;

export function defaultStateDirectory(env = process.env) {
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'armor-make');
}

export function wrapperContent(manifest, tool) {
  return `#!/bin/sh\n${wrapperMarker}\nexec ${shellQuote(process.execPath)} ${shellQuote(cliPath)} __invoke ${shellQuote(manifest)} ${shellQuote(tool)} "$@"\n`;
}

export async function loadInstallation(manifest) {
  const installation = JSON.parse(await readFile(manifest, 'utf8'));
  if (installation.schemaVersion !== 1 || typeof installation.binDirectory !== 'string' || !isAbsolute(installation.binDirectory) || typeof installation.tools !== 'object' || !installation.tools || Array.isArray(installation.tools)) {
    throw new Error(`Invalid installation manifest: ${manifest}`);
  }
  for (const [tool, value] of Object.entries(installation.tools)) {
    getAdapter(tool);
    if (!value || typeof value.program !== 'string' || !isAbsolute(value.program) || typeof value.wrapper !== 'string') {
      throw new Error(`Invalid installation entry for ${tool}.`);
    }
  }
  return installation;
}

async function atomicWrite(path, content, mode, replace = true) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode, flag: 'wx' });
    await chmod(temporary, mode);
    if (replace) await rename(temporary, path);
    else await link(temporary, path); // Atomically fail if an unrelated file appeared.
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function install({
  tools = ['git', 'tea'], binDirectory, stateDirectory,
  env = process.env, programs = {}, dryRun = false,
} = {}) {
  const bin = resolve(binDirectory || join(env.HOME || homedir(), '.local/bin'));
  const state = resolve(stateDirectory || defaultStateDirectory(env));
  const manifest = join(state, 'installation.json');
  const previous = await entryExists(manifest) ? await loadInstallation(manifest) : null;
  if (previous && previous.binDirectory !== bin) throw new Error('This state directory already belongs to a different bin directory.');
  const entries = { ...(previous?.tools ?? {}) };
  const existingEntries = new Set();

  for (const tool of [...new Set(tools)]) {
    getAdapter(tool);
    const path = join(bin, tool);
    const content = wrapperContent(manifest, tool);
    if (await entryExists(path)) {
      const existing = await readFile(path, 'utf8');
      if (!previous?.tools[tool] || existing !== previous.tools[tool].wrapper) {
        throw new Error(`Refusing to replace an existing command: ${path}`);
      }
      existingEntries.add(tool);
    }
    const program = programs[tool] ? resolve(programs[tool]) : await resolveProgram(tool, env, { excludedDirectories: [bin] });
    if (program === path) throw new Error(`Original program points to its own wrapper: ${path}`);
    if (!(await stat(program)).isFile() || await isManagedWrapper(program)) {
      throw new Error(`Original program must be an executable file, not an armor-make wrapper: ${program}`);
    }
    await access(program, constants.X_OK);
    entries[tool] = { program, wrapper: content };
  }

  const installation = { schemaVersion: 1, binDirectory: bin, tools: entries };
  const result = { manifest, binDirectory: bin, tools: Object.fromEntries(Object.entries(entries).map(([tool, value]) => [tool, { entry: join(bin, tool), program: value.program }])), dryRun };
  if (dryRun) return result;

  await mkdir(bin, { recursive: true });
  await mkdir(state, { recursive: true, mode: 0o700 });
  // The manifest is written first; installed wrappers never point at a missing manifest.
  await atomicWrite(manifest, `${JSON.stringify(installation, null, 2)}\n`, 0o600, Boolean(previous));
  for (const tool of [...new Set(tools)]) {
    const destination = join(bin, tool);
    if (existingEntries.has(tool) && await readFile(destination, 'utf8') !== previous.tools[tool].wrapper) {
      throw new Error(`Command changed during installation: ${destination}`);
    }
    await atomicWrite(destination, entries[tool].wrapper, 0o755, existingEntries.has(tool));
  }
  return result;
}

export async function uninstall({ stateDirectory, env = process.env, dryRun = false } = {}) {
  const manifest = join(resolve(stateDirectory || defaultStateDirectory(env)), 'installation.json');
  const installation = await loadInstallation(manifest);
  const removable = [];
  for (const [tool, entry] of Object.entries(installation.tools)) {
    const path = join(installation.binDirectory, tool);
    if (!(await entryExists(path))) continue;
    if (await readFile(path, 'utf8') !== entry.wrapper) throw new Error(`Refusing to remove a changed command: ${path}`);
    removable.push(path);
  }
  if (!dryRun) {
    for (const path of removable) await unlink(path);
    await unlink(manifest);
  }
  return { removedEntries: removable, manifest, dryRun };
}
