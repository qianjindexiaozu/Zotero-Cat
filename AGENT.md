# Agent Implementation Notes

## 当前定位

Zotero Agent 当前使用 Zotero 官方 `ItemPaneManager.registerSection` 实现，属于右侧条目面板中的自定义 section，不接管 Zotero 原生右侧栏。

## 已实现能力

- 侧边栏 Agent section（可见/可打开）
- 基础对话 UI（消息列表、输入框、发送）
- 发送/终止图标按钮（发送时可中断请求，鼠标悬停有 tooltip）
- Thinking 动画（`Thinking.` `Thinking..` `Thinking...` 循环）
- 打字机式增量输出（UI 层逐字渲染）
- 自动滚动到底部（多轮对话默认跟随）
- Provider 抽象层（`provider -> chat`）
- OpenAI-compatible 请求通道
- 设置页 Provider 下拉 + Model 联动下拉 + 自定义模型输入
- 中英文本地化（随 Zotero 语言切换）
- 图标静态资源统一管理（`addon/content/icons`）

## 数据存储说明

- 对话消息目前是内存态：`src/modules/agent/section.ts` 的 `runtime.messages`
- 不落盘；重启 Zotero 或重载插件后会清空

## 当前限制

- 还未支持 Markdown 渲染
- 还未支持会话持久化与多会话隔离
- 还未实现请求重试策略
- 还未实现 Zotero 上下文注入（条目元数据、笔记、批注）

## 主要代码位置

- Agent UI 与状态：`src/modules/agent/section.ts`
- Provider 抽象与请求：`src/modules/agent/provider.ts`
- 配置页联动逻辑：`src/modules/preferenceScript.ts`
- 语言包：`addon/locale/en-US/*`、`addon/locale/zh-CN/*`
- 图标资源：`addon/content/icons/*`
