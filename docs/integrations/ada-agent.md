# Ada / OpenClaw 接入

迁移日期：2026-10-14（Asia/Shanghai）。本页从 Ada 角色仓库的临时方案迁入，保存部署约束；通用行为和安装命令以 [README](../../README.md) 为准。真实全局安装、Ada 凭证配置、Gateway 重启及认证验收均尚未执行。

## 父目录配置与执行目录

```text
ada-agent/
├── .config/
│   ├── git/config
│   └── tea/config.yml
└── projects/xgj/repositories/teacher/
```

Worker 在登记项目根 projects/xgj 启动，repository 只选择技能与规范范围。命令从实际操作目录向父目录查找，不在独立 Git 根或子模块边界停止，因此上述布局能选中角色根配置。每个工具选择自己的最近文件；配置来源正确与服务端认证身份分别验收。

## 终端与 Codex

安装后的共用入口目录须在最终执行进程的 PATH 中位于原始命令之前。通过 `command -v git`、`command -v tea` 和 `armor-make inspect` 核对最终 shell，而非仅查看配置文件。

独立 Codex 如需设置 shell_environment_policy.set.PATH，须写完整路径值，不依赖 TOML 展开 $PATH。alias、function、缓存、绝对二进制路径及环境重置仍可能绕过包装入口；安装不提供不可绕过的隔离。

## Gateway 环境

此前本机核对的启动链为 LaunchAgent → shell wrapper → 私有环境文件 → Node / Gateway。环境文件在启动时提供 PATH；若覆盖 plist 中的 PATH，仅改 plist 不足以接入。其他机器以实际 LaunchAgent、systemd 或容器启动合同为准。

在既有 PATH 最前加入包装入口目录，保留 Node、CLI 所需目录、其他环境字段和文件权限。安装器不会自动修改 shell、Gateway 配置或服务状态。已运行的 Gateway 不会自动更新环境，加载新环境和重启须按部署授权执行。

agent-repo 同步按名称执行 Git，各次调用的 cwd 用于查找配置。角色根、项目根、wiki、业务子仓库和每日／主动同步分别验收，不能只用交互终端结果推断 Gateway 已接入。

## Worker 环境

```text
Gateway
  → detached Node worker（继承 Gateway 环境）
    → Codex CLI（cwd 为登记项目根）
      → shell → git / tea 包装入口 → 原始命令
```

2026-10-14 核对的插件代码在启动 CLI 时使用 config.pathPrefix + ':' + process.env.PATH。配置字段为 plugins.entries.agent-worker.config.pathPrefix。实际部署显式保留 Node 和 CLI 路径，将包装入口放在原始工具之前；不要将本机默认值作为其他机器的安装要求。

Gateway 自身和 Worker 的 PATH 分别验收。检查每个使用中的 CLI profile、最终 shell 和恢复会话。旧 Gateway、detached Worker 或 shell 不会自动迁移；切换前核对在途任务，按既有准入合同处理，避免静默切换认证或重跑业务操作。

## Ada 账号目标

配置定向不保证“所有行为必须使用 Ada”。原始命令仍有以下覆盖来源：

- Git local、worktree、-c、署名环境及 SSH 命令。
- tea 的认证环境及 --login。
- 最近子目录配置；项目配置全部缺失时回退到用户配置。
- 已核对的 agent-repo 同步代码设置 GIT_SSH_COMMAND=ssh -oBatchMode=yes -oConnectTimeout=10，覆盖 core.sshCommand；实际部署还需核对 gitEnvironment 的覆盖。

强制拒绝其他身份属于独立部署目标。需要验收选中配置、tea 用户 API 返回账号、SSH 公钥归属、HTTPS 凭证身份、显式覆盖及自动同步的实际认证。Git author 和公共仓库读取成功不能证明 push 使用的账号。业务权限和 Ada 的 SOUL.md 边界继续由对应角色仓库约束。

## 私有配置与恢复

原生配置可能含 Token、认证头、helper 和私有路径。含凭证文件须在准备前纳入 Git 忽略，并使用无凭证示例恢复；私有目录权限 700，密钥和登录文件权限 600。配置内容不进入公共文档或诊断日志。

Git include、helper、hooks 等可执行行为仍由原工具处理，管理员复核实际配置。本工具不提供账号管理或配置执行隔离。当前未创建 Ada 凭证，也未将 armor-make 登记为 Ada 业务项目。

异机按 Ada 角色仓库自己的恢复说明克隆角色和项目，再在实际目录安装本工具、准备凭证、接入服务并验收；Git clone 不恢复用户级入口、私有资料或运行环境。

## 验收与回滚

代码和离线测试确认配置查找及包装行为，不能代替真实 Gateway、后台任务或账号策略验收。部署先只读；写权限仅在明确授权的测试资源中验证服务端 actor，不向保护分支推测试提交。

卸载先运行 `armor-make uninstall --dry-run`，再按授权执行卸载；仅删除本安装拥有且内容仍匹配的入口，恢复本次拥有的 PATH 变更、刷新缓存，保留个人配置和其他工具。

插件升级后重新核对 pathPrefix、cwd、同步环境及启动合同。上述插件代码证据来自 openclaw-plugins 的 packages/agent-worker/index.mjs、packages/agent-worker/configuration.mjs 与 packages/agent-repo/workspace-sync.mjs，是核对当日的合同记录。
