import { access, lstat, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir } from 'node:os';

export const adapters = Object.freeze({
  git: { configRelativePath: 'git/config', variable: 'GIT_CONFIG_GLOBAL' },
  tea: { configRelativePath: 'tea/config.yml', variable: 'XDG_CONFIG_HOME' },
});

export function getAdapter(tool) {
  const adapter = Object.hasOwn(adapters, tool) ? adapters[tool] : null;
  if (!adapter) throw new Error(`Unsupported tool: ${tool}. Supported tools: git, tea.`);
  return adapter;
}

export async function entryExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export async function readableFile(path) {
  const info = await stat(path); // A broken link is an error, not a fallback.
  if (!info.isFile()) throw new Error(`Configuration must be a regular file: ${path}`);
  await access(path, constants.R_OK);
}

export async function nearestExistingDirectory(path) {
  let current = resolve(path);
  while (true) {
    if (await entryExists(current)) {
      const info = await stat(current);
      if (!info.isDirectory()) throw new Error(`Operation directory is not a directory: ${current}`);
      return realpath(current);
    }
    const parent = dirname(current);
    if (parent === current) throw new Error(`Cannot resolve operation directory: ${path}`);
    current = parent;
  }
}

export async function findConfiguration(tool, operationDirectory, env = process.env) {
  const adapter = getAdapter(tool);
  let directory = await nearestExistingDirectory(operationDirectory);
  const home = resolve(env.HOME || homedir());
  let realHome;
  try { realHome = await realpath(home); } catch { realHome = home; }
  const searched = [];

  while (true) {
    // HOME/.config is the original user configuration, not a project override.
    if (directory !== realHome) {
      const configHome = join(directory, '.config');
      const configFile = join(configHome, adapter.configRelativePath);
      searched.push(configFile);
      if (await entryExists(configFile)) {
        await readableFile(configFile);
        return { configFile, configHome, root: directory, searched };
      }
    }
    const parent = dirname(directory);
    if (parent === directory) return { configFile: null, configHome: null, root: null, searched };
    directory = parent;
  }
}

export function configurationEnvironment(tool, selection, env) {
  const childEnv = { ...env };
  if (selection.configFile) {
    const adapter = getAdapter(tool);
    childEnv[adapter.variable] = tool === 'git' ? selection.configFile : selection.configHome;
  }
  return childEnv;
}

export async function localRepoPath(value, cwd) {
  const candidate = resolve(cwd, value);
  if (await entryExists(candidate)) {
    if (!(await stat(candidate)).isDirectory()) throw new Error(`Repository path is not a directory: ${candidate}`);
    return candidate;
  }
  if (isAbsolute(value) || value.startsWith('./') || value.startsWith('../')) {
    throw new Error(`Repository directory does not exist: ${candidate}`);
  }
  return null; // owner/repo is a remote slug, not necessarily a local path.
}
