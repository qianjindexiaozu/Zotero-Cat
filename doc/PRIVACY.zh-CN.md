# 隐私和数据存储

[English](./PRIVACY.md) | [中文](./PRIVACY.zh-CN.md)

Zotero-Cat 是本地 Zotero 插件。项目不提供也不使用 Zotero-Cat 云端后端。

## 发送给模型提供方的数据

发送聊天请求时，Zotero-Cat 会把当前提示和已启用的上下文从 Zotero 直接发送到用户配置的提供方端点。

根据启用的选项，请求可能包含：

- 当前聊天消息。
- 当前 Zotero 条目的标题、作者、年份、DOI、URL 和摘要。
- 当前条目的子笔记。
- 当前条目的 PDF 批注。
- Zotero PDF 阅读器中最近选中的文本。
- 用户在 Zotero-Cat 聊天面板输入的自定义上下文。

如果不希望提供方接收某些内容，请在发送前关闭对应上下文开关。

## 发送给搜索提供方的数据

联网搜索默认关闭。若在聊天面板启用联网搜索，Zotero-Cat 会在模型请求前向配置的搜索提供方发送查询。查询可能包含用户提示和当前条目的标题、DOI、年份等提示信息。搜索返回的摘要片段和 URL 会随后注入到模型上下文。

搜索提供方侧的数据保留、日志和删除策略由你配置的搜索提供方决定。

## 本地数据存储

Zotero-Cat 会保存：

- 会话历史：Zotero pref `extensions.zotero.zoterocat.agentConversationStore`。
- Provider ID、Base URL、当前模型、reasoning effort 和端点提示：`extensions.zotero.zoterocat.*` 下的 Zotero prefs。
- 联网搜索开关、搜索提供方和搜索接口：`extensions.zotero.zoterocat.*` 下的 Zotero prefs。
- API Key：Firefox Login Manager，按 Provider 和 Base URL 分作用域。
- 自定义上下文：仅运行时内存保存。Zotero 重启或插件重载后清空。

会话历史设置了全局、单条目、单会话和单消息容量上限，避免本地存储无限增长。

## Zotero-Cat 不保存的数据

Zotero-Cat 不会有意把 API Key 保存到普通 Zotero prefs。Zotero-Cat 不会把数据上传到项目运营的服务。

提供方侧的数据保留、日志、训练和删除策略由你配置的提供方决定。

## 删除本地数据

- 通过 Zotero-Cat 会话控件删除会话。
- 在 Zotero-Cat 设置页清空或修改 Provider 设置。
- 如需在插件 UI 之外清除凭据，可从宿主 Firefox/Zotero Login Manager 存储中移除保存的 API Key。
