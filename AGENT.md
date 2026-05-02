# Agent Implementation Notes

## 当前定位

Zotero Agent 当前使用 Zotero 官方 `ItemPaneManager.registerSection` 实现，属于右侧条目面板中的自定义 section，不接管 Zotero 原生右侧栏。

## 已实现能力

- 侧边栏 Agent section（可见/可打开）
- 基础对话 UI（消息列表、输入框、发送）
- 发送/终止图标按钮（发送时可中断请求，鼠标悬停有 tooltip）
- 等待响应动画（`.` `..` `...` 循环）
- 回复元数据显示响应等待耗时（本地从发送到首段可用输出的等待时间）
- 流式优先输出与打字机式增量渲染
- 自动滚动到底部（多轮对话默认跟随）
- Provider 抽象层（`provider -> chat`）
- OpenAI-compatible 请求通道（`responses` / `chat.completions` 兼容探测）
- API Key 安全存储（Firefox Login Manager，已迁移旧明文偏好）
- 设置页 Provider 下拉、Base URL、API Key、保存与测试连接
- Agent 输入区模型列表获取、模型选择、自定义模型与思考强度选择
- 中英文本地化（随 Zotero 语言切换）
- 图标静态资源统一管理（`addon/content/icons`）
- 输出消息 Markdown 预览（安全渲染）
- Prompt 模板系统（可切换）
- 可选 Zotero 上下文注入（元数据、笔记、批注、选中文本）
- 可折叠上下文预览、注入预算提示、模型上下文窗口提示
- 用户自定义上下文（默认折叠，点击展开；与只读 Zotero 自动上下文一起注入）
- 历史会话管理（按条目隔离、原生下拉切换、最多展示最近 8 条、新会话、清空、删除）
- 对话持久化（Zotero prefs JSON，保存活跃会话指针，带条目数/会话数/消息数/单消息长度上限）
- 可恢复错误重试（请求未产生输出前自动重试一次）
- 诊断面板（记录重试、模型列表获取失败、最终请求错误）
- 思考强度从模型列表元数据读取；提供方未声明时只显示默认
- 消息复制与复制成功反馈
- 第三方 OpenAI-compatible endpoint 成功路径记忆

## 数据存储说明

- 对话消息按条目 key 和会话 id 持久化在 Zotero pref `agentConversationStore`
- 持久化与历史下拉有硬上限：最多 64 个历史会话、每个条目最多 8 个历史会话、每个会话最多 40 条消息、单条消息最多 8000 字符
- 用户自定义上下文目前是内存态：`src/modules/agent/section.ts` 的 `runtime.customContextByItemKey`，按 `libraryID:itemKey` 隔离
- Provider、Base URL、模型、思考强度与 endpoint hint 存在 Zotero prefs
- API Key 按 `provider + baseURL` 维度存在 Firefox Login Manager

## 当前限制

- 历史会话当前使用原生下拉切换，最多保留并展示每个条目的最近 8 条；不支持搜索、重命名、收藏、分页、懒加载或导出
- 重试只覆盖请求尚未产生输出前的可恢复错误；流式输出已开始后不会自动重试
- 用户自定义上下文按条目隔离但不持久化；重启 Zotero 或重载插件后会清空
- 模型列表获取依赖站点提供 OpenAI-compatible `/models` JSON 响应
- 思考强度依赖 `/models` 返回 `reasoning_efforts`、`supported_reasoning_efforts`、`reasoning.efforts` 等字段；缺失时显示未声明
- token 预算是轻量估算，不等同于具体模型 tokenizer 的精确结果
- 模型上下文窗口依赖 `/models` 返回 `context_length`、`max_model_len` 等字段；缺失时显示未知

## 主要代码位置

- Agent UI 与状态：`src/modules/agent/section.ts`
- Provider 抽象与请求：`src/modules/agent/provider.ts`
- Zotero 上下文组装：`src/modules/agent/context.ts`
- Prompt 模板：`src/modules/agent/promptTemplates.ts`
- API Key 安全存储：`src/modules/agent/secureApiKey.ts`
- 配置页联动逻辑：`src/modules/preferenceScript.ts`
- 语言包：`addon/locale/en-US/*`、`addon/locale/zh-CN/*`
- 图标资源：`addon/content/icons/*`
