#!/usr/bin/env node
import { resolve } from 'node:path';
import { planInvocation, publicPlan, runInvocation } from '../src/commands.js';
import { install, loadInstallation, uninstall } from '../src/install.js';

const help = `armor-make — prefer native configuration in the current directory or its parents

Usage:
  armor-make run <git|tea> [original arguments...]
  armor-make inspect <git|tea> [original arguments...]
  armor-make install [git tea] [options]
  armor-make uninstall [--state-dir <directory>] [--dry-run]

Install options:
  --bin-dir <directory>     Wrapper directory (default: ~/.local/bin)
  --state-dir <directory>   Installation manifest directory
  --git-bin <file>          Explicit original Git executable
  --tea-bin <file>          Explicit original tea executable
  --dry-run                Show the installation plan without writing files

Directory configuration:
  git: .config/git/config  -> GIT_CONFIG_GLOBAL
  tea: .config/tea/config.yml -> XDG_CONFIG_HOME
  Nearest matching file wins; no match preserves the original environment.
`;

function installationOptions(args, mode) {
  const options = { tools: [], programs: {} };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (['--bin-dir', '--state-dir', '--git-bin', '--tea-bin'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      if (arg === '--bin-dir') options.binDirectory = value;
      else if (arg === '--state-dir') options.stateDirectory = value;
      else options.programs[arg === '--git-bin' ? 'git' : 'tea'] = value;
    } else if (arg === 'git' || arg === 'tea') options.tools.push(arg);
    else throw new Error(`Unknown ${mode} argument: ${arg}`);
  }
  if (!options.tools.length) options.tools = ['git', 'tea'];
  if (mode === 'uninstall' && (options.binDirectory || Object.keys(options.programs).length || args.some(arg => arg === 'git' || arg === 'tea'))) {
    throw new Error('uninstall accepts only --state-dir and --dry-run.');
  }
  return options;
}

async function main(args) {
  const [command, ...tail] = args;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(help);
    return 0;
  }
  if (command === '--version') { process.stdout.write('armor-make 0.1.0\n'); return 0; }
  if (command === 'install' || command === 'uninstall') {
    const options = installationOptions(tail, command);
    const result = await (command === 'install' ? install(options) : uninstall(options));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return 0;
  }
  if (command === '__invoke') {
    const [manifest, tool, ...originalArgs] = tail;
    if (!manifest || !tool) throw new Error('Incomplete wrapper invocation.');
    const installation = await loadInstallation(resolve(manifest));
    const entry = Object.hasOwn(installation.tools, tool) ? installation.tools[tool] : null;
    if (!entry) throw new Error(`Tool is not installed: ${tool}`);
    return runInvocation(await planInvocation(tool, originalArgs, { program: entry.program }));
  }
  if (command === 'run' || command === 'inspect') {
    const [tool, ...originalArgs] = tail;
    if (!tool) throw new Error(`Usage: armor-make ${command} <git|tea> [arguments...]`);
    const plan = await planInvocation(tool, originalArgs);
    if (command === 'inspect') { process.stdout.write(`${JSON.stringify(publicPlan(plan), null, 2)}\n`); return 0; }
    return runInvocation(plan);
  }
  throw new Error(`Unknown command: ${command}. Use --help.`);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`armor-make: ${error.message}\n`);
  process.exitCode = 2;
}
