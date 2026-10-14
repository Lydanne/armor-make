# 项目 AI 环境

初始化日期：2026-10-14。配置范围是本仓库，不改变个人全局技能、模型配置、登录凭证或运行中的服务。

## 已选择的技能

以下七个技能来自 [mattpocock/skills](https://github.com/mattpocock/skills)，固定在提交 49dd158d1076134a641b33efb035946536778336，以完整目录安装到 .agents/skills/。

| 技能 | 用途 |
| --- | --- |
| tdd | 在约定接口上按 red → green → refactor 实现行为 |
| diagnosing-bugs | 为疑难错误和性能问题建立可重复的诊断信号 |
| codebase-design | 设计小接口、清晰职责和可验证的工具适配 |
| domain-modeling | 维护产品术语，按真实取舍记录 ADR |
| code-review | 固定基点后的 Standards / Spec 两轴审查 |
| pr | 以变化、证据和影响范围描述 PR |
| writing-for-agents | 编写简短入口和按条件读取的 AI 文档 |

保留上游正文、引用和 agents/openai.yaml；没有改写技能、额外安装全局插件或复制整套技能库。code-review 在被调用时要求平行子审查；仅安装技能不表示本次已经发起审查。宿主缺少所需工具时如实报告限制。

上游交互 setup 的工程配套资料已按本项目情况准备：GitHub 工作项约定、单上下文领域资料、根 AGENTS.md 和明确的技能入口。没有调用交互 setup 技能、初始化 triage 标签或修改 GitHub 工作项。

## 项目入口

- [AGENTS.md](../AGENTS.md)：目标、实现约束、验证、Git 和技能入口。
- [GLOSSARY.md](../GLOSSARY.md)：用户已经澄清的产品术语。
- [项目上下文](agents/project-context.md)：当前扩展和验收边界。
- [测试约定](agents/testing.md)：可观察接口及测试范围。
- [工作项约定](agents/issue-tracker.md)：GitHub 和外部写入授权。
- [领域资料约定](agents/domain.md)：术语及 ADR 消费方式。

尚未初始化个人 Claude/Codex 配置或 API 模型环境。以 armor-make 为工作区启动 Codex 后，项目技能可从 .agents/skills/ 发现，规则从 AGENTS.md 读取；这是文件初始化，不是当前其他工作区会话已切换的证明。[Codex 技能说明](https://learn.chatgpt.com/docs/build-skills)

在 Codex 提问中可以明确引用，例如：

```text
$codebase-design 检查新的工具适配接口
$tdd 为 git clone 的配置选择实现一个需求明确的行为切片
$diagnosing-bugs 排查这个可复现的参数转发错误
$code-review 审查相对 main 的变更
```

这些是提问示例，不是 shell 命令，也不保证其他宿主注册相同的原生斜杠命令。完整正文按命中的任务读取，不例行加载七份技能。已有明确目标和授权沿用；技能不能授予生产变更、全局安装或任意 Git 写入权限。

## 来源与更新

.agents/skills/sources.json 是本项目的自定义来源清单，不是 skills.sh 的 skills-lock.json。它记录原目录、固定提交、各文件 SHA-256 和上游 Git blob，便于核验完整复制及本地变更。

上游技能使用 MIT 许可，原许可保留在 .agents/skills/LICENSE.mattpocock。这不改变本项目当前 package.json 的 UNLICENSED 状态。

更新时选择新的明确提交，比较技能的触发规则、权限、引用和宿主依赖后再替换并更新清单。保留上游原文，项目约定放在本仓库文档；不要修改 vendor 文件后仍声称与上游一致。

## 核验

```bash
npm run check:ai
```

检查清单及上游 blob 校验、必需的 skill 元数据、支持文件完整性和本地 Markdown 链接。代码验证仍使用现有 check、test；npm 打包只含运行时 files 清单，项目技能和 AI 文档不会自动进入运行时包。

通过文件检查不能代替真实宿主的技能调用验收。下一轮以本项目为工作区时查看技能选择器；若未刷新，按宿主方式重载或开启新会话。运行结果及安装/发布状态分别报告。
