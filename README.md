# Zotero-Agent

Zotero 侧边栏 Agent 插件，参考 Codex in VS Code 的交互方式，并支持可切换的模型来源（OpenAI-compatible / 自建网关 / 本地服务）。

## 技术栈

- Zotero 插件模板：`windingwind/zotero-plugin-template`
- 构建工具：`zotero-plugin-scaffold`
- 语言：TypeScript
- 许可证：`AGPL-3.0-or-later`

## 兼容性目标

- 开发与验证基线：Zotero 9
- 当前清单上限：`strict_max_version = 99.*`
- 策略：每个 Zotero 新大版本发布后尽快完成验证并更新兼容字段

## 快速开始

1. 复制环境文件并填写路径：

```bash
cp .env.example .env
```

2. 安装依赖：

```bash
npm install
```

3. 启动开发：

```bash
npm start
```

## 仓库内辅助插件（Codex）

- `plugins/zotero-dev`: 后续封装 build/serve/release 常用命令
- `plugins/llm-provider-test`: 后续封装 provider 连通性与流式测试

插件市场清单在 `.agents/plugins/marketplace.json`。

## 路线图

开发计划见 [TODO.md](./TODO.md)。
