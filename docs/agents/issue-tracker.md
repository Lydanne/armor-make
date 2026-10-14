# Issue tracker: GitHub

工作项和协作 PR 属于 [Lydanne/armor-make](https://github.com/Lydanne/armor-make)。在本项目中使用 gh CLI，核对真实 remote 和当前身份；不复用其他仓库的任务授权。

## 读取与写入

用户给出工作项编号、PR 或 URL 时先读取必要标题和正文，区分需求依据与评论参考。没有关联工作项时，以本轮明确需求或已有本地规格为依据；代码审查可以明确记录未提供独立规格，不为了满足模板自动建 Issue。

Issue 创建、评论、标签、关闭以及 PR 提交/合并等写入遵守用户当前授权。技能里的“publish”只有在该技能/任务确实被授权发起时才对应实际外部写入。安装 AI 环境本身不授权创建工作项、标签或外部通知。

多行 Issue/PR 正文先写到私有临时文件，再以 --body-file 提交，避免 shell 转义改变内容。读取和交付报告保留真实 URL，不包含凭证。

## Triage

PRs as a request surface: no.

当前没有安装 triage、to-spec 或 to-tickets，也不建立自动标签状态机。以后明确采用这些流程时再初始化相应模板和标签，沿用已有标签而不是重复创建。
