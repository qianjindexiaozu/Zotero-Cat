# TODO - Zotero-Agent

## Phase 0: 仓库初始化

- [x] 选择并声明开源许可证（AGPL-3.0-or-later）
- [x] 建立基础文档（README / CONTRIBUTING / TODO）
- [x] 初始化 Zotero 插件模板（Zotero 9 兼容配置）
- [x] 创建 Codex 辅助 plugins 骨架（zotero-dev / llm-provider-test）

## Phase 1: MVP（可用最小版本）

- [ ] 侧边栏 Agent Section 可见并可打开
- [ ] 基础对话 UI（消息列表 + 输入框 + 发送）
- [ ] Provider 抽象层（`provider -> chat` 统一接口）
- [ ] 首个 OpenAI-compatible Provider（自定义 base URL / model）
- [ ] API Key 与 endpoint 设置页（本地配置）

## Phase 2: Zotero 上下文能力

- [ ] 注入当前条目元数据（title/authors/year/DOI 等）
- [ ] 注入可选上下文（笔记、批注、选中文本）
- [ ] Prompt 模板系统（可切换任务模板）

## Phase 3: 体验增强

- [ ] 流式输出（增量渲染）
- [ ] 取消请求 / 超时 / 重试
- [ ] 会话管理（新建、清空、按条目隔离）
- [ ] 错误可观测性（日志和诊断面板）

## Phase 4: 兼容与发布

- [ ] 验证 Zotero 9 当前稳定版
- [ ] 验证 Zotero 新 beta 版本（前向兼容巡检）
- [ ] 打包产物（XPI）与发布流程
- [ ] 版本策略与变更记录（CHANGELOG）
