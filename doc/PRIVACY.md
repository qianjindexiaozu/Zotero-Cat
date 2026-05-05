# Privacy And Data Storage

[English](./PRIVACY.md) | [中文](./PRIVACY.zh-CN.md)

Zotero-Cat is a local Zotero plugin. It does not provide or use a Zotero-Cat
cloud backend.

## Data Sent To Model Providers

When you send a chat request, Zotero-Cat sends the selected prompt and enabled
context directly from Zotero to the configured provider endpoint.

Depending on enabled options, a request may include:

- Your current chat messages.
- The selected Zotero item's title, creators, year, DOI, URL, and abstract.
- Child notes for the selected item.
- PDF annotations for the selected item.
- Text recently selected in Zotero's PDF reader.
- Custom context typed into the Zotero-Cat chat panel.

Disable context toggles before sending if a provider should not receive that
data.

## Data Sent To Search Providers

Web search is off by default. If you enable it in the chat panel, Zotero-Cat
sends a search query to the configured search provider before the model request.
The query can include your prompt and selected item hints such as title, DOI, or
year. Returned search snippets and URLs are then injected into the model context.

Search-provider retention, logging, and deletion policies are controlled by the
search provider you configure.

## Local Data Storage

Zotero-Cat stores:

- Conversation history in Zotero pref
  `extensions.zotero.zoterocat.agentConversationStore`.
- Provider ID, Base URL, selected model, reasoning effort, and endpoint hints in
  Zotero prefs under `extensions.zotero.zoterocat.*`.
- Web search enablement, provider ID, and endpoint in Zotero prefs under
  `extensions.zotero.zoterocat.*`.
- API Keys in Firefox Login Manager, scoped by provider and Base URL.
- Custom context only in runtime memory. It clears after Zotero restarts or the
  plugin reloads.

Conversation history is capped globally, per item, per conversation, and per
message to reduce unbounded local storage growth.

## Data Not Stored By Zotero-Cat

Zotero-Cat does not intentionally store API Keys in plain Zotero prefs.
Zotero-Cat does not upload data to a project-operated service.

Provider-side retention, logging, training, and deletion policies are controlled
by the provider you configure.

## Removing Local Data

- Delete conversations from the Zotero-Cat session controls.
- Clear or change provider settings from the Zotero-Cat preferences pane.
- Remove saved API Keys through the host Firefox/Zotero Login Manager storage if
  you need to purge credentials outside the plugin UI.
