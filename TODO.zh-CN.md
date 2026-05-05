# TODO - Zotero-Cat

[English](./TODO.md) | [中文](./TODO.zh-CN.md)

本文件按阶段记录项目计划。保持务实：每个已勾选项目都应对应已实现代码、已提交文档或已验证流程。

## 当前项目状态

- 项目名：`Zotero-Cat`
- 包名：`zotero-cat`
- 插件 ID：`zotero-cat@qianjindexiaozu.dev`
- Namespace / chrome path：`zoterocat`
- 全局 Zotero 实例：`Zotero.ZoteroCat`
- Pref prefix：`extensions.zotero.zoterocat`
- License：`AGPL-3.0-or-later`
- 开发运行时：Node.js 24 LTS
- 当前实现目标：Zotero 9

## Phase 0: 仓库初始化

- [x] 选择并声明开源许可证：`AGPL-3.0-or-later`。
- [x] 创建基础文档：`README.md`、`CONTRIBUTING.md`、`TODO.md`。
- [x] 使用 Zotero 9 兼容目标初始化 Zotero 插件脚手架。
- [x] 创建仓库本地 Codex helper plugin 骨架：`zotero-dev`、`llm-provider-test`。
- [x] 在 package metadata、plugin metadata、本地化、prompt identity、文档和 Git remote 中把项目重命名为 Zotero-Cat。
- [x] 添加 Node 版本文件：`.nvmrc`、`.node-version`。

## Phase 1: MVP

目标：插件能在 Zotero 内加载，渲染可用助手面板，并通过可配置 Provider 发送基础模型请求。

- [x] 通过 `ItemPaneManager.registerSection` 注册 Zotero item-pane section。
- [x] 渲染基础聊天 UI，包含消息列表、输入框和发送按钮。
- [x] 添加固定高度聊天布局和底部输入区。
- [x] 创建 Provider 抽象：`provider -> chat`。
- [x] 实现第一个 OpenAI-compatible provider。
- [x] 添加 Provider、Base URL、模型和 API Key 设置。
- [x] 添加 Provider 下拉和常见 provider presets。
- [x] 分离 Save Settings 和 Test Connection。
- [x] 通过 Firefox Login Manager 存储 API Key。
- [x] 为中文和英文 Zotero 添加本地化 UI 文本。

## Phase 2: Zotero 上下文

目标：让模型回复能利用阅读和审阅 Zotero 条目所需的上下文，减少用户手动粘贴。

- [x] 注入当前条目元数据：标题、作者、年份、DOI、URL、摘要等。
- [x] 支持可选笔记注入。
- [x] 支持可选 PDF 批注注入。
- [x] 从 Zotero PDF reader selection popup 捕获选中文本。
- [x] 添加 prompt template 系统。
- [x] 添加上下文预览。
- [x] 添加 token 预算估算。
- [x] 当 Provider metadata 声明模型上下文窗口时显示该信息。
- [x] 添加用户自定义上下文输入。
- [x] 预览中的 Zotero 自动上下文保持只读。
- [x] 自定义上下文默认折叠，点击后展开。

## Phase 3: 体验增强

目标：让助手适合反复阅读和多轮使用。

- [x] 支持助手输出流式返回。
- [x] 支持打字机式增量渲染。
- [x] 添加请求取消。
- [x] 根据请求状态显示发送图标和终止图标。
- [x] 添加发送和终止按钮 tooltip。
- [x] 添加 60 秒请求超时。
- [x] 探测第三方端点路径并记住成功路径提示。
- [x] 从 OpenAI-compatible `/models` endpoint 获取模型列表。
- [x] 在聊天区域添加模型选择和自定义模型输入。
- [x] 按 Provider 声明的模型 metadata 显示 reasoning effort 选择。
- [x] 添加复制按钮和可见复制反馈。
- [x] 在输出开始前对可恢复请求错误执行重试策略。
- [x] 添加每个条目的历史会话和原生下拉。
- [x] 添加新建会话、清空会话、删除会话操作。
- [x] 将会话历史持久化到 Zotero prefs。
- [x] 持久化每个条目的 active conversation pointer。
- [x] 限制历史容量。
- [x] 添加 `Thinking.` / `Thinking..` / `Thinking...` 等待动画。
- [x] 基于本地发送到首个输出的时间显示响应等待耗时。
- [x] 聊天窗口保持 90 percent height。
- [x] 输入区固定在底部。
- [x] 正常流式输出时自动滚动，完成后不跳回顶部。
- [x] 安全渲染助手 Markdown。
- [x] 添加重试和请求错误诊断面板。

## Phase 3.5: 工程质量

目标：在打包和公开发布前降低回归风险。

- [x] 添加 Provider endpoint fallback 单元测试。
- [x] 添加模型列表探测和连接解析单元测试。
- [x] 添加上下文预览和 token 估算测试。
- [x] 添加会话持久化解析测试。
- [x] 添加启动脚手架测试。
- [x] 添加 Zotero UI 人工回归清单：`doc/UI_REGRESSION_CHECKLIST.md`。
- [x] 让 `npm test` 通过 `--exit-on-finish` 在完成后退出。
- [x] 更新 CI，通过 `actions/setup-node@v4` 使用 `.nvmrc`。
- [x] CI jobs 使用 `npm ci`。
- [x] 从 item-pane UI 模块拆出模型元数据解析、会话持久化、条目作用域、聊天重试分类和共享 agent message types。
- [x] 移除聊天 UI 和偏好设置 Test Connection 之间重复的模型列表解析逻辑。
- [x] 让纯逻辑测试直接导入纯模块，而不是导入 UI 文件中的 test-only exports。

## Phase 4: 兼容性和发布

目标：产出可安装 XPI，并让本地开发机器之外的用户可以使用项目。

仓库侧发布准备已经完成。GUI 和打包安装检查仍是人工发布门禁，必须在公开打标签前记录。

- [ ] 在 Zotero 9 当前稳定版运行 `doc/UI_REGRESSION_CHECKLIST.md`。
- [ ] 记录人工回归结果，包括 Zotero version、OS、date、provider。
- [ ] 如可用，验证最新 Zotero beta 或下一个主要预发布版本。
- [x] 首次发布前确认 `strict_min_version` 和 `strict_max_version`。
- [x] 本地构建 XPI artifact。
- [ ] 通过 Zotero Add-ons Manager 验证 XPI 可安装。
- [ ] 安装打包 XPI 后验证设置和会话持久化。
- [x] 添加 `CHANGELOG.md`。
- [x] 定义 `0.x` release versioning policy。
- [x] 定义 release branch/tag naming。
- [x] 添加 GitHub release workflow dry-run 路径。
- [x] 添加安装说明和截图采集要求。
- [x] 添加 OpenAI-compatible 服务的 Provider setup examples。
- [x] 添加用户隐私和数据存储说明。
- [x] 添加 Zotero trademark/non-affiliation disclaimer 到公开页面。
- [x] 为面向用户的公开 Markdown 文件提供英文和中文版本。
- [x] 记录本地自动化发布校验和 XPI hash。

## Phase 5: 公开产品打磨

目标：为 GitHub stars、早期用户和 issue reports 做准备，不提前过度建设。

- [ ] 创建项目网站 `zoterocat.org`，或先重定向到 GitHub repo。
- [ ] 在 README 添加简洁产品截图。
- [ ] 添加短 demo GIF 或视频。
- [ ] 添加 issue templates：bug report、provider compatibility、feature request。
- [ ] 邮件配置完成后添加 security contact：`security@zoterocat.org`。
- [ ] 添加 support/contact email：`contact@zoterocat.org`。
- [ ] 添加 GitHub repository topics。
- [ ] 如果贡献者开始询问内部结构，添加简短 architecture document。
- [ ] 准备 Zotero community channels launch notes。

## Backlog

这些有用，但不属于当前 release path。

- [x] 可选 web search tool integration。
- [ ] 修复选中文本、PDF 批注和其他长 prompt 上下文输入被过早截断的问题。
- [ ] 模板化工具调用编排代码，让联网搜索和未来工具共用 action 解析、执行、重试和续问流程。
- [ ] 每个条目的持久化自定义上下文。
- [ ] 会话导出。
- [ ] 会话重命名或收藏。
- [ ] 如果 OpenAI-compatible 行为不足，添加更多 provider-specific adapters。
- [ ] 使用 provider/model-specific tokenizer 改进 token counting。
- [ ] 当 Zotero automation 足够稳定后，添加启动测试之外的 UI tests。
