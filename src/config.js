import { access, lstat, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export const adapters = Object.freeze({
  git: { configRelativePath: '.gitconfig', variable: 'GIT_CONFIG_GLOBAL' },
  tea: { configRelativePath: '.config/tea/config.yml', variable: 'XDG_CONFIG_HOME' },
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

export async function findConfiguration(tool, operationDirectory) {
  const adapter = getAdapter(tool);
  let directory = await nearestExistingDirectory(operationDirectory);
  const searched = [];

  while (true) {
    const projectHome = join(directory, '.armor', 'home');
    searched.push(projectHome);
    if (await entryExists(projectHome)) {
      if (!(await stat(projectHome)).isDirectory()) {
        throw new Error(`Project configuration home must be a directory: ${projectHome}`);
      }
      const configFile = join(projectHome, adapter.configRelativePath);
      if (!(await entryExists(configFile))) {
        throw new Error(`Missing ${tool} configuration in selected project home: ${configFile}`);
      }
      await readableFile(configFile);
      let sshConfig = null;
      if (tool === 'git') {
        const candidate = join(projectHome, '.ssh', 'config');
        if (await entryExists(candidate)) {
          await readableFile(candidate);
          sshConfig = candidate;
        }
      }
      return { configFile, configHome: join(projectHome, '.config'), projectHome, sshConfig, root: directory, searched };
    }
    const parent = dirname(directory);
    if (parent === directory) return { configFile: null, configHome: null, projectHome: null, sshConfig: null, root: null, searched };
    directory = parent;
  }
}

export function configurationEnvironment(tool, selection, env) {
  const childEnv = { ...env };
  if (selection.configFile) {
    const adapter = getAdapter(tool);
    childEnv[adapter.variable] = tool === 'git' ? selection.configFile : selection.configHome;
    if (tool === 'git' && selection.sshConfig) {
      // GIT_SSH_COMMAND is parsed by Git's shell, so quote the entire path.
      const command = `ssh -F '${selection.sshConfig.replaceAll("'", "'\\''")}'`;
      if (env.GIT_SSH || (env.GIT_SSH_COMMAND && env.GIT_SSH_COMMAND !== command)) {
        throw new Error('SSH configuration conflict: project .ssh/config cannot be combined with an existing GIT_SSH or GIT_SSH_COMMAND.');
      }
      childEnv.GIT_SSH_COMMAND = command;
      childEnv.GIT_SSH_VARIANT = 'ssh';
    }
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
