import { constants } from 'node:fs';
import { access, open, stat } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import { promisify } from 'node:util';
import {
  configurationEnvironment, entryExists, findConfiguration, getAdapter, localRepoPath,
} from './config.js';

export const wrapperMarker = '# armor-make managed wrapper v1';
const executeFile = promisify(execFile);

export async function isManagedWrapper(path) {
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(512);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString('utf8').includes(wrapperMarker);
  } finally { await file.close(); }
}

function requiredValue(args, index, flag) {
  if (index + 1 >= args.length) throw new Error(`Missing value for ${flag}.`);
  return args[index + 1];
}

const gitCloneValueFlags = new Set([
  '-b', '--branch', '-o', '--origin', '-c', '--config', '-j', '--jobs', '-u', '--upload-pack',
  '--depth', '--shallow-since', '--shallow-exclude', '--reference', '--reference-if-able',
  '--separate-git-dir', '--template', '--filter', '--server-option', '--bundle-uri', '--revision',
]);

function positionalArguments(args, valueFlags) {
  const values = [];
  let literal = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!literal && arg === '--') { literal = true; continue; }
    if (!literal && valueFlags.has(arg)) {
      requiredValue(args, index, arg);
      index++;
      continue;
    }
    if (!literal && arg.startsWith('-')) continue;
    values.push(arg);
  }
  return values;
}

function cloneDestination(source, bare = false) {
  let path = source.replace(/[\\/]+$/, '');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    path = new URL(path).pathname.replace(/\/+$/, '');
  }
  let name = path.split(/[/:\\]/).at(-1);
  if (!name || name === '.' || name === '..') throw new Error('Cannot determine clone destination; specify a target directory.');
  name = name.replace(/\.git$/, '');
  return bare ? `${name}.git` : name;
}

export async function operationDirectory(tool, args, cwd, env = process.env, realProgram) {
  getAdapter(tool);
  let directory = resolve(cwd);
  if (tool === 'git') {
    let explicitMetadata = Boolean(env.GIT_DIR || env.GIT_WORK_TREE);
    let commandIndex = -1;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === '-C') {
        const value = requiredValue(args, index, arg);
        if (value) directory = resolve(directory, value);
        index++;
      } else if (arg === '-c' || arg === '--config-env' || arg === '--namespace') {
        requiredValue(args, index, arg);
        index++;
      } else if (arg === '--git-dir' || arg === '--work-tree' || arg.startsWith('--git-dir=') || arg.startsWith('--work-tree=')) {
        explicitMetadata = true;
        if (arg === '--git-dir' || arg === '--work-tree') { requiredValue(args, index, arg); index++; }
      } else if (arg === '--') {
        commandIndex = index + 1;
        break;
      } else if (!arg.startsWith('-')) {
        commandIndex = index;
        break;
      }
    }
    if (commandIndex >= 0 && args[commandIndex] === 'clone') {
      const tail = args.slice(commandIndex + 1);
      const positionals = positionalArguments(tail, gitCloneValueFlags);
      if (positionals.length) return resolve(directory, positionals[1] ?? cloneDestination(positionals[0], tail.includes('--bare') || tail.includes('--mirror')));
    }
    if (explicitMetadata && !args.includes('--version') && !args.includes('--help')) {
      const program = realProgram ?? await resolveProgram(tool, env);
      const prefix = args.slice(0, commandIndex < 0 ? args.length : commandIndex);
      const probeOptions = { cwd, env: { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' }, timeout: 5000, maxBuffer: 1024 * 1024 };
      try {
        const { stdout } = await executeFile(program, [...prefix, 'rev-parse', '--show-toplevel'], probeOptions);
        return resolve(stdout.trim());
      } catch (error) {
        // Bare repositories have no worktree; their metadata directory is the scope.
        const { stdout: bare } = await executeFile(program, [...prefix, 'rev-parse', '--is-bare-repository'], probeOptions);
        if (bare.trim() !== 'true') throw new Error(`Cannot locate the Git worktree: ${error.stderr?.trim() || error.message}`);
        const { stdout } = await executeFile(program, [...prefix, 'rev-parse', '--absolute-git-dir'], probeOptions);
        return resolve(stdout.trim());
      }
    }
    return directory;
  }

  // tea allows repository flags after the command as well as on subcommands.
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--') break;
    let repo;
    if (arg === '--repo' || arg === '-r') { repo = requiredValue(args, index, arg); index++; }
    else if (arg.startsWith('--repo=')) repo = arg.slice(7);
    else if (arg.startsWith('-r=')) repo = arg.slice(3);
    if (repo !== undefined) {
      const local = await localRepoPath(repo, directory);
      if (local) directory = local;
    }
  }
  const teaValues = new Set(['--login', '-l', '--depth', '-d']);
  const teaArgs = positionalArguments(args, teaValues);
  if (teaArgs[0] === 'clone' || teaArgs[0] === 'C') {
    if (teaArgs[1]) return resolve(directory, teaArgs[2] ?? cloneDestination(teaArgs[1]));
  }
  return directory;
}

export async function resolveProgram(tool, env = process.env, { excludedDirectories = [] } = {}) {
  getAdapter(tool);
  const excluded = new Set(excludedDirectories.map(path => resolve(path)));
  for (const directory of (env.PATH ?? '').split(delimiter)) {
    const absolute = resolve(directory || '.');
    if (excluded.has(absolute)) continue;
    const candidate = join(absolute, tool);
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      if (await isManagedWrapper(candidate)) continue;
      return candidate;
    } catch (error) {
      if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) continue;
      throw error;
    }
  }
  throw new Error(`Cannot find the original ${tool} executable in PATH.`);
}

export async function planInvocation(tool, args, {
  cwd = process.cwd(), env = process.env, program,
} = {}) {
  const executable = program ?? await resolveProgram(tool, env);
  const directory = await operationDirectory(tool, args, cwd, env, executable);
  const selection = await findConfiguration(tool, directory, env);
  return {
    tool, program: executable, args: [...args], cwd,
    operationDirectory: directory,
    ...selection,
    env: configurationEnvironment(tool, selection, env),
  };
}

export function publicPlan(plan) {
  const adapter = getAdapter(plan.tool);
  return {
    tool: plan.tool, program: plan.program, cwd: plan.cwd,
    operationDirectory: plan.operationDirectory,
    source: plan.configFile ? 'directory' : 'original',
    projectHome: plan.projectHome,
    configFile: plan.configFile,
    sshConfig: plan.sshConfig,
    configurationOverride: plan.configFile ? {
      name: adapter.variable,
      value: plan.tool === 'git' ? plan.configFile : plan.configHome,
    } : null,
    searched: plan.searched,
  };
}

export function runInvocation(plan) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(plan.program, plan.args, { cwd: plan.cwd, env: plan.env, stdio: 'inherit', shell: false });
    const forwarders = new Map();
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      const handler = () => child.kill(signal);
      forwarders.set(signal, handler);
      process.on(signal, handler);
    }
    const cleanup = () => {
      for (const [signal, handler] of forwarders) process.off(signal, handler);
    };
    child.once('error', error => { cleanup(); reject(error); });
    child.once('close', (code, signal) => {
      cleanup();
      resolveResult(code ?? 128 + (osConstants.signals[signal] ?? 1));
    });
  });
}
