# 更新日志

[English](./CHANGELOG.md) | [中文](./CHANGELOG.zh-CN.md)

这里记录 Zotero-Cat 的重要变更。首次公开稳定承诺前，Zotero-Cat 使用 `0.x` 版本。

## [0.1.0] - 2026-05-03

### 新增

- Zotero 条目面板助手 section，带本地化聊天界面。
- OpenAI-compatible Provider 支持：流式输出、端点探测、端点 fallback、模型列表获取，以及提供方声明的 reasoning effort 控制。
- Zotero 上下文注入：条目元数据、笔记、PDF 批注、PDF 选中文本，以及按请求注入的自定义上下文。
- 每个 Zotero 条目独立的会话历史，支持 Zotero pref 持久化、活动会话跟踪和容量上限。
- API Key 通过 Firefox Login Manager 保存。
- 诊断面板展示重试、模型列表、超时、取消和 Provider 错误。
- 共享纯逻辑模块：模型元数据解析、会话存储、条目作用域、重试分类、运行时 ID 和 agent 消息类型。
- 自动化测试覆盖 Provider fallback、模型探测、上下文预览、会话持久化解析、流式 delta 解析和启动加载。
- 发布文档覆盖安装、Provider 配置、隐私、版本规则、标签规则和人工兼容性门禁。

### 变更

- 首个候选版本的打包插件只声明兼容 Zotero 9：`strict_min_version` 为 `9.0`，`strict_max_version` 为 `9.*`。
- GitHub release workflow 现在在仓库内直接运行 lint、build、tests 和 artifact upload，然后只在 `v*` 标签推送时发布。

### 发布说明

- 当前不声明 Zotero 10 beta 兼容性；需要先在当前 Zotero beta 线运行人工 UI 清单。
- 公开 GitHub release 打标签前，必须记录打包 XPI 安装和持久化验证结果。
