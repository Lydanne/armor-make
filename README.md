# armor-make

使用 Node.js 实现的命令包装工具：给现有命令套一层入口，在执行前后扩展功能，再调用原来的官方程序。

第一个扩展功能是父目录配置优先读取：从当前操作目录逐级向父目录寻找原生配置，找到就让本次调用使用它；找不到则保留工具原来的用户级配置。首版适配 Git 和 tea，零第三方依赖，需要 Node.js 22 或以上。

## 原理

```text
git / tea
  -> armor-make 的同名入口
  -> 从操作目录逐级查找 .config/<工具>/...
  -> 找到：为官方程序设置配置路径环境变量
  -> 未找到：原参数、原环境透传
  -> 官方程序执行原命令
```

| 工具 | 逐级寻找的文件 | 本次子进程设置 |
| --- | --- | --- |
| Git | `.config/git/config` | `GIT_CONFIG_GLOBAL=找到的文件` |
| tea | `.config/tea/config.yml` | `XDG_CONFIG_HOME=找到的 .config 目录` |

配置格式和实际业务逻辑仍由官方 Git、tea 处理。工具不会修改 HOME、个人全局配置、仓库远端或项目登记，不解析配置中的 Token 来拼命令。

## 项目配置

例如在工作区根准备：

```text
workspace/
├── .config/
│   ├── git/config
│   └── tea/config.yml
└── projects/example/repositories/app/
```

从 app 目录执行，也会向上找到工作区根的配置，不在独立仓库或子模块的 `.git` 边界停止。

Git 文件使用原生格式：

```ini
[user]
    name = ProjectUser
    email = project-user@example.com
```

此例只设置提交署名，不设置远端认证。tea 文件使用 `tea/config.yml` 的原生登录格式；准备文件时使用管理员实际授权的账号和凭证。

含 Token、密钥、认证头的配置必须放在 Git 忽略的私有位置，文件权限设为 `600`，私有目录为 `700`。本工具不自动生成或收集凭证；不要把真实配置内容贴进公开报告。

## 本地使用

在本项目目录中，无需安装即可检查和运行；也可以把入口路径写成实际绝对路径：

```bash
node bin/armor-make.js inspect git status
node bin/armor-make.js run git status
node bin/armor-make.js inspect tea issues
```

`inspect` 只展示命令程序、操作目录、搜索路径及命中的配置文件，不读取或展示配置内容，不执行目标命令。显式 Git 元数据参数的定位会调用真实 Git 的只读 rev-parse；普通调用不需要额外 Git 子进程。

运行时原命令参数原样传递，使用参数数组而非 shell 字符串；stdin、stdout、stderr 继承，退出码和终止信号状态传回调用方。

## 安装同名入口

先预览：

```bash
node bin/armor-make.js install git tea --dry-run
```

确认后运行相同命令去掉 `--dry-run`，将生成 `~/.local/bin/git`、`~/.local/bin/tea`，安装信息保存在 `$XDG_CONFIG_HOME/armor-make/installation.json`，未设置 XDG_CONFIG_HOME 时为 `~/.config/armor-make/installation.json`。

安装信息只保存真实程序路径和受管理入口内容，不登记项目账号或身份根。已有同名命令不属于本安装时会拒绝覆盖；重复安装本工具拥有的入口可更新路径。

可指定局部目录或只安装一个工具：

```bash
node bin/armor-make.js install git \
  --bin-dir /absolute/local-bin \
  --state-dir /absolute/private-state \
  --git-bin /absolute/original-git \
  --dry-run
```

入口使用安装时记录的 Node 和本工具绝对路径，不依赖目标进程能找到 `node`。移动本工具或移除该 Node 版本后需要重新安装入口；用户配置和官方程序不受安装器改写。

要直接输入 `git`、`tea`，需要使入口目录位于 PATH 中真实程序之前。安装器只创建入口，不修改 shell 配置或重启服务。检查最终执行环境：

```bash
command -v git
command -v tea
```

如果使用 pnpm 全局安装本包，`armor-make` 主命令也可按名称调用；Git/tea 同名入口仍需通过 install 显式安装。安装原始项目代码不会自动创建 Git/tea 入口。

## 查找规则

- 从当前工具的实际操作目录开始，最近的对应文件优先。
- 子目录只有 tea 配置时，Git 仍继续向上寻找自己的文件。
- 不自动合并多份祖先配置；Git 原生 include 仍由 Git 自行处理。
- 用户 HOME 本身的 `.config` 保留为原始用户配置，不把它当作项目覆盖；其他祖先仍按顺序搜索。
- 文件已存在但不是可读普通文件或链接损坏时报错，不悄悄回退。
- 配置内容非法时由官方程序报错，不回退其他账号。
- 根配置被删除后重新查找祖先或用户配置，这是优先查找语义，不是固定身份策略。
- Git 的连续 `-C`、clone 目标、本地 tea `--repo` 和 clone 目标参与目录定位。
- 显式 Git 目录/工作树参数或环境通过真实 Git 的只读定位处理；裸仓库使用其 Git 目录。CLI 的未核验特殊语法仍需按实际版本补充测试。

## OpenClaw、Worker、Codex 接入

通用入口按实际 cwd 查找配置，不要求主会话先切换目录。Worker 在工作区的子项目启动时，可以找到祖先目录的配置。

按实际部署配置执行环境：

| 执行入口 | 配置方式 |
| --- | --- |
| 终端 | 使入口目录优先于真实程序，检查 alias、function 和命令缓存 |
| agent-worker | 在适用的 pathPrefix 中让入口目录优先，核对 Codex 最终 shell |
| OpenClaw Gateway | 在实际服务启动环境中设置 PATH；交互终端环境不代表服务环境 |
| 独立 Codex | 核对其命令进程 PATH；必要时设置有效 shell_environment_policy.set.PATH |

已运行的进程不会因安装入口或更改配置自动更新 PATH。旧 Worker、新任务、自动同步和独立 Codex 分别验收；安装不等于服务接入完成。

## 配置优先读取与固定账号

armor-make 首版只选择配置来源，保留官方优先级和显式参数：

- Git 的 `.git/config`、worktree 配置、`-c`、署名及 SSH 环境可以覆盖 global 来源。
- tea 的认证环境或 `--login` 可能覆盖选中的登录配置。
- OpenClaw 自动同步明确设置的 GIT_SSH_COMMAND 会覆盖 core.sshCommand。

因此这不是“所有命令不可绕过地必须使用指定账号”的保证。这个目标需要额外的身份冲突/缺失校验与同步接入；不能仅凭配置路径正确或公共仓库读取成功宣称认证账号已确认。

配置会改变官方程序的行为，也可能涉及 Git include、helper 和 hooks。本工具不提供对原生配置执行行为的安全隔离，不自动执行额外项目脚本。

## 卸载

```bash
node bin/armor-make.js uninstall --dry-run
node bin/armor-make.js uninstall
```

只删除本安装记录中内容仍匹配的入口和安装清单；其他命令、个人配置和 PATH 不动。入口被其他人修改时拒绝删除。自定义 state-dir 的安装需要传入相同目录。

## 开发与验证

```bash
pnpm install --frozen-lockfile
pnpm run check
pnpm run check:ai
pnpm test
```

测试使用临时目录和替身命令，覆盖最近配置、用户配置回退、错误传播、参数转发、安装保护、卸载和 Git 原生优先级。真实 Git 测试只操作临时仓库；本机有 tea 时使用离线 login list 验证读取临时登录配置，不发送 API 请求或业务消息。

真实凭证、Gateway 配置、全局安装和运行中的 Worker 不在测试范围内。没有第三方依赖，直接运行不需要安装依赖；首次开发执行 pnpm install --frozen-lockfile 核对锁文件。

## AI 协作

项目规则由 [AGENTS.md](AGENTS.md) 提供，选定的 Matt Pocock 工程技能保存在 .agents/skills/，不修改个人全局环境。选择理由、来源校验和调用示例见 [AI 环境说明](docs/ai-environment.md)。

## 发布状态

仓库用于维护源代码；当前 package.json 设置为 private，未发布到 npm。许可证尚未选择，package.json 暂标记为 UNLICENSED。

## 服务接入

Ada、OpenClaw Gateway 和 agent-worker 的 PATH、配置继承及账号验收边界，见 [Ada / OpenClaw 接入](docs/integrations/ada-agent.md)。该说明记录接入方案，实际服务部署另行验收。
