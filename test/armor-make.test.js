import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { findConfiguration, entryExists } from '../src/config.js';
import { operationDirectory, planInvocation, publicPlan, resolveProgram } from '../src/commands.js';
import { install, uninstall } from '../src/install.js';

const execute = promisify(execFile);
const cli = fileURLToPath(new URL('../bin/armor-make.js', import.meta.url));
const git = await resolveProgram('git');
const tea = await resolveProgram('tea').catch(() => null);

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'armor-make-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const project = join(root, 'project');
  const child = join(project, 'projects/xgj/repositories/teacher');
  await mkdir(home, { recursive: true });
  await mkdir(child, { recursive: true });
  const env = { ...process.env, HOME: home };
  delete env.GIT_DIR; delete env.GIT_WORK_TREE;
  return { root, home, project, child, env };
}

async function file(path, content) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

async function stubProgram(path, exitCode = 0) {
  await file(path, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),global:process.env.GIT_CONFIG_GLOBAL,xdg:process.env.XDG_CONFIG_HOME,extra:process.env.KEEP_ME,home:process.env.HOME,ssh:process.env.GIT_SSH_COMMAND}));\nprocess.stderr.write('native stderr');\nprocess.exitCode=${exitCode};\n`);
  await chmod(path, 0o755);
  return path;
}

test('tools share the nearest project home across independent repository boundaries', async t => {
  const f = await fixture(t);
  const rootGit = await file(join(f.project, '.armor/home/.gitconfig'), '[user]\nname = Ada\n');
  const rootTea = await file(join(f.project, '.armor/home/.config/tea/config.yml'), 'logins: []\n');
  await file(join(f.child, '.git'), 'gitdir: elsewhere\n');
  const childTea = await file(join(f.child, '.armor/home/.config/tea/config.yml'), 'logins: []\n');
  await assert.rejects(findConfiguration('git', f.child, f.env), /Missing git configuration/);
  assert.equal((await findConfiguration('tea', f.child, f.env)).configFile, childTea);
  await rm(join(f.child, '.armor'), { recursive: true });
  assert.equal((await findConfiguration('git', f.child, f.env)).configFile, rootGit);
  assert.equal((await findConfiguration('tea', f.child, f.env)).configFile, rootTea);
});

test('no directory config preserves existing environment, including custom configuration variables', async t => {
  const f = await fixture(t);
  const env = { ...f.env, GIT_CONFIG_GLOBAL: '/original/git', XDG_CONFIG_HOME: '/original/xdg', KEEP_ME: 'value' };
  const plan = await planInvocation('git', ['status'], { cwd: f.child, env, program: git });
  assert.equal(plan.configFile, null);
  assert.deepEqual(plan.env, env);
});

test('HOME/.config is treated as original user config, not a project override', async t => {
  const f = await fixture(t);
  const cwd = join(f.home, 'work/project');
  await mkdir(cwd, { recursive: true });
  await file(join(f.home, '.config/git/config'), '[user]\nname = Personal\n');
  await file(join(f.project, '.config/git/config'), '[user]\nname = OldProject\n');
  assert.equal((await findConfiguration('git', cwd, f.env)).configFile, null);
});

test('existing invalid or dangling candidate fails instead of falling back', async t => {
  const f = await fixture(t);
  await file(join(f.project, '.armor/home/.gitconfig'), '[user]\nname = Ada\n');
  const bad = join(f.child, '.armor/home/.gitconfig');
  await mkdir(bad, { recursive: true });
  await assert.rejects(findConfiguration('git', f.child, f.env), /regular file/);
  await rm(bad, { recursive: true });
  await symlink(join(f.root, 'missing'), bad);
  await assert.rejects(findConfiguration('git', f.child, f.env), error => error.code === 'ENOENT');
});

test('Git -C is resolved sequentially, including config flags before the command', async t => {
  const f = await fixture(t);
  assert.equal(await operationDirectory('git', ['-c', 'color.ui=false', '-C', 'projects', '-C', 'xgj', 'status'], f.project, f.env), join(f.project, 'projects/xgj'));
  await assert.rejects(operationDirectory('git', ['-C'], f.project, f.env), /Missing value/);
});

test('clone configuration is located from its destination, not an unrelated caller', async t => {
  const f = await fixture(t);
  await file(join(f.project, '.armor/home/.gitconfig'), '[user]\nname = Ada\n');
  const destination = join(f.child, 'new repo');
  const plan = await planInvocation('git', ['clone', '--depth', '1', 'https://example.test/owner/source.git', destination], { cwd: f.home, env: f.env, program: git });
  assert.equal(plan.operationDirectory, destination);
  assert.equal(plan.root, f.project);
  assert.equal(await operationDirectory('git', ['clone', '--bare', 'git@example.test:owner/source.git'], f.project, f.env), join(f.project, 'source.git'));
});

test('tea uses local --repo paths but preserves server slugs', async t => {
  const f = await fixture(t);
  assert.equal(await operationDirectory('tea', ['issues', '--repo', f.child], f.home, f.env), f.child);
  assert.equal(await operationDirectory('tea', ['issues', '--repo=owner/repository'], f.home, f.env), f.home);
  await assert.rejects(operationDirectory('tea', ['issues', '-r', './missing'], f.home, f.env), /does not exist/);
  assert.equal(await operationDirectory('tea', ['clone', '--login', 'ada', '--depth', '1', 'owner/source', f.child], f.home, f.env), f.child);
});

test('real Git reads selected global configuration and retains native local precedence', async t => {
  const f = await fixture(t);
  const cwd = join(f.project, 'projects/xgj');
  await execute(git, ['init', '--quiet', cwd], { env: f.env });
  const config = await file(join(f.project, '.armor/home/.gitconfig'), '[user]\nname = Ada\nemail = ada@example.test\n');
  const read = await execute(process.execPath, [cli, 'run', 'git', 'config', '--get', 'user.name'], { cwd, env: f.env });
  assert.equal(read.stdout.trim(), 'Ada');
  const origin = await execute(process.execPath, [cli, 'run', 'git', 'config', '--global', '--show-origin', '--get', 'user.name'], { cwd, env: f.env });
  assert.match(origin.stdout, new RegExp(config.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await execute(git, ['-C', cwd, 'config', '--local', 'user.name', 'Local'], { env: f.env });
  const local = await execute(process.execPath, [cli, 'run', 'git', 'config', '--get', 'user.name'], { cwd, env: f.env });
  assert.equal(local.stdout.trim(), 'Local');
});

test('Git metadata options and environment use the actual worktree', async t => {
  const f = await fixture(t);
  await execute(git, ['init', '--quiet', f.child], { env: f.env });
  const args = [`--git-dir=${join(f.child, '.git')}`, `--work-tree=${f.child}`, 'status'];
  assert.equal(await operationDirectory('git', args, f.home, f.env, git), f.child);
  const env = { ...f.env, GIT_DIR: join(f.child, '.git'), GIT_WORK_TREE: f.child };
  assert.equal(await operationDirectory('git', ['status'], f.home, env, git), f.child);
  const bare = join(f.project, 'bare.git');
  await execute(git, ['init', '--bare', '--quiet', bare], { env: f.env });
  assert.equal(await operationDirectory('git', [`--git-dir=${bare}`, 'log'], f.home, f.env, git), bare);
});

test('installed tea wrapper forwards arguments, environment and native exit status', async t => {
  const f = await fixture(t);
  const program = await stubProgram(join(f.root, 'native tea'), 7);
  await file(join(f.project, '.armor/home/.config/tea/config.yml'), 'logins: []\n');
  const binDirectory = join(f.root, 'wrapped bin');
  const stateDirectory = join(f.root, 'state');
  await install({ tools: ['tea'], programs: { tea: program }, binDirectory, stateDirectory, env: f.env });
  await assert.rejects(execute(join(binDirectory, 'tea'), ['api', 'path with spaces', '$(literal)'], { cwd: f.child, env: { ...f.env, KEEP_ME: 'unchanged' } }), error => {
    assert.equal(error.code, 7);
    assert.equal(error.stderr, 'native stderr');
    const output = JSON.parse(error.stdout);
    assert.deepEqual(output.args, ['api', 'path with spaces', '$(literal)']);
    assert.equal(output.xdg, join(f.project, '.armor/home/.config'));
    assert.equal(output.extra, 'unchanged');
    return true;
  });
});

test('real tea loads the selected native login configuration without making API requests', { skip: !tea }, async t => {
  const f = await fixture(t);
  await file(join(f.project, '.armor/home/.config/tea/config.yml'), 'logins:\n  - name: directory-only\n    url: https://example.invalid\n    user: directory-user\n    token: fake-test-token\n    default: true\n');
  const result = await execute(process.execPath, [cli, 'run', 'tea', 'login', 'list'], { cwd: f.child, env: f.env });
  assert.match(result.stdout, /directory-only/);
  assert.match(result.stdout, /directory-user/);
  assert.doesNotMatch(result.stdout, /fake-test-token/);
});

test('malformed native Git configuration returns the native error rather than using user configuration', async t => {
  const f = await fixture(t);
  await file(join(f.project, '.armor/home/.gitconfig'), '[invalid\n');
  await assert.rejects(execute(process.execPath, [cli, 'run', 'git', 'config', '--get', 'user.name'], { cwd: f.child, env: f.env }), error => {
    assert.equal(error.code, 128);
    assert.match(error.stderr, /bad config line/);
    return true;
  });
});

test('installation is idempotent, dry-run is read-only, and existing commands are protected', async t => {
  const f = await fixture(t);
  const native = await stubProgram(join(f.root, 'native git'));
  const options = { tools: ['git'], programs: { git: native }, binDirectory: join(f.root, 'bin'), stateDirectory: join(f.root, 'state'), env: f.env };
  await install({ ...options, dryRun: true });
  assert.equal(await entryExists(options.binDirectory), false);
  assert.equal(await entryExists(options.stateDirectory), false);
  await install(options);
  const first = await readFile(join(options.binDirectory, 'git'), 'utf8');
  await install(options);
  assert.equal(await readFile(join(options.binDirectory, 'git'), 'utf8'), first);
  await file(join(options.binDirectory, 'tea'), 'existing tool');
  await assert.rejects(install({ ...options, tools: ['tea'], programs: { tea: native } }), /Refusing to replace/);
  await uninstall({ stateDirectory: options.stateDirectory, env: f.env, dryRun: true });
  assert.equal(await entryExists(join(options.binDirectory, 'git')), true);
  await uninstall({ stateDirectory: options.stateDirectory, env: f.env });
  assert.equal(await entryExists(join(options.binDirectory, 'git')), false);
  assert.equal(await readFile(join(options.binDirectory, 'tea'), 'utf8'), 'existing tool');
});

test('inspect never includes configuration contents or unrelated secret environment values', async t => {
  const f = await fixture(t);
  await file(join(f.project, '.armor/home/.gitconfig'), '[example]\ntoken = private-test-token\n');
  const plan = await planInvocation('git', ['status'], { cwd: f.child, env: { ...f.env, SECRET: 'hidden-env' }, program: git });
  const diagnostic = JSON.stringify(publicPlan(plan));
  assert.equal(diagnostic.includes('private-test-token'), false);
  assert.equal(diagnostic.includes('hidden-env'), false);
  assert.equal(publicPlan(plan).source, 'directory');
});


test('installed Git uses project .armor/home without changing HOME', async t => {
  const f = await fixture(t);
  const config = await file(join(f.project, '.armor/home/.gitconfig'), '[user]\nname = Ada\n');
  const program = await stubProgram(join(f.root, 'native git'));
  const binDirectory = join(f.root, 'bin');
  await install({ tools: ['git'], programs: { git: program }, binDirectory, stateDirectory: join(f.root, 'state'), env: f.env });
  const result = await execute(join(binDirectory, 'git'), ['status'], { cwd: f.child, env: f.env });
  const output = JSON.parse(result.stdout);
  assert.equal(output.global, config);
  assert.equal(output.home, f.home);
});


test('Git explicitly selects optional project SSH config and preserves HOME', async t => {
  const f = await fixture(t);
  await file(join(f.project, '.armor/home/.gitconfig'), '[user]\nname = Ada\n');
  const sshConfig = await file(join(f.project, '.armor/home/.ssh/config'), 'Host *\n  IdentityAgent none\n');
  const program = await stubProgram(join(f.root, 'native git'));
  const plan = await planInvocation('git', ['status'], { cwd: f.child, env: f.env, program });
  const result = await execute(plan.program, plan.args, { cwd: plan.cwd, env: plan.env });
  const output = JSON.parse(result.stdout);
  assert.equal(output.ssh, `ssh -F '${sshConfig}'`);
  assert.equal(output.home, f.home);
  assert.equal(publicPlan(plan).sshConfig, sshConfig);
  await assert.rejects(planInvocation('git', ['status'], { cwd: f.child, env: { ...f.env, GIT_SSH_COMMAND: 'ssh -oBatchMode=yes' }, program }), /SSH configuration conflict/);
});

test('inspect rejects an incomplete or invalid nearest project home without falling back', async t => {
  const f = await fixture(t);
  await file(join(f.project, '.armor/home/.gitconfig'), '[user]\nname = Parent\n');
  await file(join(f.child, '.armor/home/.config/tea/config.yml'), 'logins: []\n');
  await assert.rejects(execute(process.execPath, [cli, 'inspect', 'git', 'status'], { cwd: f.child, env: f.env }), error => {
    assert.match(error.stderr, /Missing git configuration/);
    return true;
  });
  await rm(join(f.child, '.armor/home'), { recursive: true });
  await file(join(f.child, '.armor/home'), 'not a directory');
  await assert.rejects(execute(process.execPath, [cli, 'inspect', 'git', 'status'], { cwd: f.child, env: f.env }), error => {
    assert.match(error.stderr, /must be a directory/);
    return true;
  });
});

test('project SSH command handles quoted paths and inherited child invocations', async t => {
  const f = await fixture(t);
  const project = join(f.project, "space ' $(literal) `literal`");
  await file(join(project, '.armor/home/.gitconfig'), '[user]\nname = Ada\n');
  const sshConfig = await file(join(project, '.armor/home/.ssh/config'), 'Host *\n  HostName fixture.invalid\n  IdentityAgent none\n');
  const plan = await planInvocation('git', ['status'], { cwd: project, env: f.env, program: git });
  const result = await execute('/bin/sh', ['-c', `${plan.env.GIT_SSH_COMMAND} -G fixture.invalid`], { cwd: project, env: plan.env });
  assert.match(result.stdout, /^hostname fixture.invalid$/m);
  const nested = await planInvocation('git', ['status'], { cwd: project, env: plan.env, program: git });
  assert.equal(nested.env.GIT_SSH_COMMAND, plan.env.GIT_SSH_COMMAND);
  assert.equal(publicPlan(nested).sshConfig, sshConfig);
  await assert.rejects(planInvocation('git', ['status'], { cwd: project, env: { ...f.env, GIT_SSH: '/custom/ssh' }, program: git }), /SSH configuration conflict/);
});
