# Armor Make AI 协作规范

## 项目目标

Armor Make 给现有命令套一层包装入口，在执行前后扩展功能，再调用原始命令。当前扩展是父目录配置优先读取，首批工具适配器为 Git、tea。

使用中文沟通。涉及产品行为、目录查找或新适配器时先读 [项目上下文](docs/agents/project-context.md) 和 [术语表](GLOSSARY.md)。新需求以用户明确目标为准，不从技能示例推导额外功能。

## 实现与验证

- 使用 Node.js 22+、JavaScript ESM 和标准库。保持现有零第三方运行时依赖；新增依赖说明实际缺口，语言迁移另按明确需求处理。
- 子进程使用参数数组及环境副本；命令执行、配置解析仍交给原始命令。命中的配置错误如实报错，未命中时保留原环境和参数。
- 修改路径识别、命令转发或安装行为时，按 [测试约定](docs/agents/testing.md) 验证可观察行为。修复先建立能捕获本问题的失败信号，再修改实现。
- 运行 package.json 中适用的检查；代码变更至少执行 npm run check 和 npm test，AI 资料变更执行 npm run check:ai。打包改动另检查 npm pack --dry-run。
- 使用临时目录和替身命令。测试无需真实凭证、业务 API、用户全局入口或运行中的服务；诊断只展示定位信息，配置内容和认证数据不进入日志、报告或 Git。
- 目录配置选择不提供身份锁定；保留原始命令的配置优先级和显式覆盖。验收区分本地行为、平台 CI、安装、实际账号及服务接入。

## Git 交付

任务分支使用 codex/*，保留无关改动。提交、推送和 PR 按当前用户授权范围执行；使用 Conventional Commits，仅暂存当前任务文件。

main 的合并、npm 发布、用户级安装、个人配置修改及服务重启分别按明确授权执行。技能不扩大这些权限；已有授权和已明确事项沿用，不重复要求确认。

## Agent skills

技能位于 .agents/skills/，读取命中的 SKILL.md，再按需读取引用，不例行加载全部技能。来源、校验及使用示例见 [AI 环境说明](docs/ai-environment.md)。

| 任务 | 技能 |
| --- | --- |
| 功能或缺陷的测试驱动实现 | tdd |
| 难复现错误或性能问题 | diagnosing-bugs |
| 模块接口、工具适配器或可测试性设计 | codebase-design |
| 术语和有实际取舍的架构记录 | domain-modeling |
| 固定基点后的变更审查 | code-review |
| PR 描述 | pr |
| 本文件或 AI 文档修改 | writing-for-agents |

### Issue tracker

工作项使用 Lydanne/armor-make 的 GitHub Issues；读取和外部写入范围见 [工作项约定](docs/agents/issue-tracker.md)。技能安装不自动建单或创建标签。

### Domain docs

采用单上下文布局：根 GLOSSARY.md 和按需创建的 docs/adr/。术语消费及 ADR 条件见 [领域资料约定](docs/agents/domain.md)。
