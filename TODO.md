# TODO - Zotero-Agent

## Phase 0: 仓库初始化

- [x] 选择并声明开源许可证（AGPL-3.0-or-later）
- [x] 建立基础文档（README / CONTRIBUTING / TODO）
- [x] 初始化 Zotero 插件模板（Zotero 9 兼容配置）
- [x] 创建 Codex 辅助 plugins 骨架（zotero-dev / llm-provider-test）

## Phase 1: MVP（可用最小版本）

- [x] 侧边栏 Agent Section 可见并可打开
- [x] 基础对话 UI（消息列表 + 输入框 + 发送）
- [x] Provider 抽象层（`provider -> chat` 统一接口）
- [x] 首个 OpenAI-compatible Provider（自定义 base URL / model）
- [x] API Key 与 endpoint 设置页（本地配置）
- [x] Provider 下拉与主流模型联动选择（含自定义模型）
- [x] 设置保存与测试连接分离（测试不隐式写入配置）
- [x] API Key 安全存储（Firefox Login Manager）

## Phase 2: Zotero 上下文能力

- [x] 注入当前条目元数据（title/authors/year/DOI 等）
- [x] 注入可选上下文（笔记、批注、选中文本）
- [x] Prompt 模板系统（可切换任务模板）
- [x] 上下文内容可视化预览与 token 预算提示
- [x] 用户自定义上下文输入

## Phase 3: 体验增强

- [x] 流式输出（增量渲染）
- [x] 取消请求（发送中可终止）
- [x] 请求超时（60s）
- [x] 第三方 endpoint 自动探测与成功路径记忆
- [x] 从站点获取模型列表（OpenAI-compatible `/models`）
- [x] 输入区模型选择、自定义模型与思考强度选择
- [x] 消息复制与复制成功反馈
- [ ] 重试策略
- [ ] 会话管理（新建、清空、按条目隔离）
- [ ] 对话持久化（当前为内存态）
- [x] 等待响应动画（`.` `..` `...` 循环）
- [x] 响应等待耗时显示（本地从发送到首段可用输出的等待时间）
- [x] 固定高度聊天窗（90%）+ 自动滚动跟随
- [x] 输出消息 Markdown 预览（安全渲染）
- [ ] 错误可观测性（日志和诊断面板）

## Phase 3.5: 工程质量

- [x] Provider endpoint fallback 单元测试
- [x] 模型列表探测与连接测试单元测试
- [ ] Zotero UI 手动回归清单

## Phase 4: 兼容与发布

- [ ] 验证 Zotero 9 当前稳定版
- [ ] 验证 Zotero 新 beta 版本（前向兼容巡检）
- [ ] 打包产物（XPI）与发布流程
- [ ] 版本策略与变更记录（CHANGELOG）
