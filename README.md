# armor-make

使用 Node.js 实现的命令包装工具：给现有命令套一层入口，在执行前后扩展功能，再调用原来的官方程序。

第一个扩展功能是父目录配置优先读取：从当前操作目录逐级寻找最近的 `.armor/home`，以它作为统一的项目配置根；没有项目配置根时保留原用户环境。首版适配 Git 和 tea，零第三方依赖，需要 Node.js 22 或以上。

## 原理

```text
git / tea
  -> armor-make 的同名入口
  -> 从操作目录逐级查找最近的 .armor/home
  -> 找到：为官方程序设置配置路径环境变量
  -> 未找到：原参数、原环境透传
  -> 官方程序执行原命令
```

| 工具 | 项目配置根中的文件 | 本次子进程设置 |
| --- | --- | --- |
| Git | `.armor/home/.gitconfig` | `GIT_CONFIG_GLOBAL=找到的文件` |
| tea | `.armor/home/.config/tea/config.yml` | `XDG_CONFIG_HOME=项目配置根/.config` |

配置格式和实际业务逻辑仍由官方 Git、tea 处理。工具不会修改 HOME、个人全局配置、仓库远端或项目登记，不解析配置中的 Token 来拼命令。

## 项目配置

例如在工作区根准备：

```text
workspace/
├── .armor/home/
│   ├── .gitconfig
│   ├── .ssh/config          # 可选
│   └── .config/tea/config.yml
└── projects/example/repositories/app/
```

从 app 目录执行，也会向上找到工作区根的配置，不在独立仓库或子模块的 `.git` 边界停止。

`.armor/home/.gitconfig` 使用原生格式：

```ini
[user]
    name = ProjectUser
    email = project-user@example.com
```

此例只设置提交署名，不设置远端认证。tea 文件使用原生 YAML 登录格式；准备文件时使用管理员实际授权的账号和凭证。

在使用本工具的项目 .gitignore 中加入 `.armor/`。含 Token、密钥、认证头的配置必须放在 Git 忽略的私有位置，文件权限设为 `600`，私有目录为 `700`。本工具不自动生成或收集凭证；不要把真实配置内容贴进公开报告。

## 本地使用

在本项目目录中，无需安装即可检查和运行；也可以把入口路径写成实际绝对路径：

```bash
node bin/armor-make.js inspect git status
node bin/armor-make.js run git status
node bin/armor-make.js inspect tea issues
```

`inspect` 只展示命令程序、操作目录、项目配置根、搜索路径及命中的配置文件（含可选 SSH 配置路径），不读取或展示配置内容，不执行目标命令。显式 Git 元数据参数的定位会调用真实 Git 的只读 rev-parse；普通调用不需要额外 Git 子进程。

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

- 从工具的实际操作目录开始，选定最近的 `.armor/home`；Git、tea 共用同一个项目配置根。
- 未找到配置根时原环境透传；找到后要求对应工具配置文件存在且可读，缺失、损坏或类型错误就报错，不再寻找其他祖先或个人配置。
- 不自动合并多个项目配置根。Git 原生 include 由 Git 处理，建议使用相对于 `.gitconfig` 的路径；`~/` 仍指真实 HOME。
- 原生 `~/.gitconfig`、`~/.config` 及旧项目 `.config` 不作为项目入口。
- 原生配置内容非法时由原程序报错。删除整个项目配置根后重新寻找祖先或回到原环境；仅删除某工具文件会报缺失。
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

## 可选 SSH 配置

项目配置根中存在 `.ssh/config` 时，Git 调用设置 `GIT_SSH_COMMAND=ssh -F <该文件>` 和 `GIT_SSH_VARIANT=ssh`，由 PATH 中的原始 SSH 读取配置。路径经过 shell 引号处理；工具不会生成密钥或读取配置内容。

若原环境已有不同的 `GIT_SSH_COMMAND` 或非空 `GIT_SSH`，明确报冲突，不覆盖或猜测合并。相同配置的子进程可以继承。没有项目 `.ssh/config` 时保持原 SSH 环境不变。指定 `-F` 后 SSH 不再自动读取默认用户／系统配置，所需代理、端口和信任设置应写入该文件。

HOME 未改变，SSH 配置中的 `~` 仍指原账号主目录。密钥、known_hosts 及 Include 使用明确的绝对路径。需要限定密钥来源时，在该原生配置中设置 IdentityFile、IdentitiesOnly 和 IdentityAgent；实际认证仍按服务端结果验收。

## 配置优先读取与固定账号

本工具定向配置来源，不提供强制账号隔离：

- Git local、worktree、`-c`、署名环境和 HTTPS credential helper 仍按原生规则工作；项目 SSH 命令环境的优先级高于 core.sshCommand。
- tea 的认证环境或 `--login` 可能选择不同账号。文件 Token 保存在 YAML；OAuth 还涉及配置目录中的独立凭证文件和系统安全存储，不能当作已隔离的项目账号。
- HOME、缓存目录、SSH agent 和系统钥匙串保持原用户环境；不会给 Gateway、Codex 或 Worker 切换 HOME。

公共仓库读取成功、配置路径正确和提交署名都不能证明远端认证身份。原生配置的 include、helper、hooks 等执行行为由管理员复核。

## 从旧布局迁移

旧项目 `.config/git/config` 移到 `.armor/home/.gitconfig`，旧 `.config/tea/config.yml` 移到 `.armor/home/.config/tea/config.yml`。先加入 Git 忽略，保留私有权限并核对 Git include 的相对路径；本工具不自动移动凭证，也不兼容扫描旧布局。

可选 SSH 文件需按前述路径和环境冲突规则准备。已安装的入口读取安装时记录的源码位置；同一位置更新源码即可使用新规则，移动源码后需重新安装。跨布局更新前准备配置，使用 inspect 核对，再执行原命令。

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
