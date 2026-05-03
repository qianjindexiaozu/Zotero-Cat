# Zotero-Cat Implementation Notes

This file is the handoff document for future coding sessions. Read it before changing code. Keep it factual and update it whenever architecture, storage, provider behavior, or release workflow changes.

## Project Identity

- Product name: `Zotero-Cat`
- Package name: `zotero-cat`
- Add-on display name: `Zotero-Cat`
- Add-on ID: `zotero-cat@qianjindexiaozu.dev`
- Add-on namespace: `zoterocat`
- Zotero global instance: `Zotero.ZoteroCat`
- Zotero pref prefix: `extensions.zotero.zoterocat`
- Repository path on the current machine: `/Users/qianjindexiaozu/projects/Zotero-Cat`
- Remote: `git@github.com:qianjindexiaozu/Zotero-Cat.git`
- Domain owned by the maintainer: `zoterocat.org`
- License: `AGPL-3.0-or-later`

Zotero-Cat is independent from Zotero. Public docs should include a non-affiliation statement.

## Current Position

Zotero-Cat is a Zotero item-pane assistant. It uses Zotero's official `ItemPaneManager.registerSection` API, so it appears as a section in Zotero's existing right item pane. It does not replace Zotero's native right sidebar and does not try to own the full pane.

The current implementation covers MVP, Zotero context injection, streaming chat UX, per-item history, persistence, diagnostics, and Phase 3.5 engineering quality. Recent structure work moved model metadata parsing, conversation persistence, item scoping, retry classification, and shared message types out of the item-pane UI file. Phase 4 should focus on compatibility verification and release packaging.

## Development Environment

Use Node.js 24 LTS.

Version files:

- `.nvmrc`: `24`
- `.node-version`: `24`
- `package.json` engines: `>=24 <25`

Core commands:

```bash
nvm use
npm install
npm run lint:check
npm run build
npm test
npm start
```

`npm test` runs `zotero-plugin test --exit-on-finish`. This matters because the scaffold test runner otherwise keeps Zotero test processes alive after the suite prints `20 passed`.

CI uses `actions/setup-node@v4` with `node-version-file: .nvmrc`, then `npm ci`.

## Main Architecture

### Add-on bootstrap

- `src/index.ts` creates `Zotero.ZoteroCat` if it does not exist.
- `src/addon.ts` holds shared add-on state and hook references.
- `src/hooks.ts` handles startup, shutdown, main-window loading, preference pane registration, and reader selected-text event registration.
- `zotero-plugin.config.ts` reads package config and passes name, ID, namespace, prefs prefix, and script output path to `zotero-plugin-scaffold`.

### Agent UI

Primary file: `src/modules/agent/section.ts`.

Responsibilities:

- Register and unregister the item-pane section.
- Render the full chat UI.
- Manage runtime UI state.
- Handle send, stop, retry, streaming output, copy feedback, diagnostics, model selection, context controls, and session controls.
- Coordinate conversation loading and saving through `conversationStore.ts`.

Important UI decisions:

- The chat panel uses fixed height. The current TODO states 90 percent height.
- The input composer belongs at the bottom of the panel.
- The session selector stays at the top of the chat area.
- History uses a native dropdown, not a custom lazy list.
- The dropdown shows up to 8 recent conversations for the current Zotero item.
- Custom context stays folded until the user opens it.
- Provided Zotero context is read-only in preview.

Do not convert this into a full replacement sidebar unless the product direction changes. The current strategy favors plugin-template compatibility and low blast radius inside Zotero.

### Shared agent logic

Pure logic lives outside `section.ts` so it can be tested without importing the UI module:

- `src/modules/agent/types.ts`: shared `AgentRole` and `AgentMessage` types.
- `src/modules/agent/modelMetadata.ts`: model endpoint candidate generation, model-list parsing, context-window extraction, reasoning-effort extraction, and model endpoint retry classification.
- `src/modules/agent/conversationStore.ts`: conversation state types, defensive persistence parsing, serialization, capacity limits, and active-conversation payload building.
- `src/modules/agent/itemScope.ts`: parent-item resolution and stable per-item scope keys.
- `src/modules/agent/chatRetry.ts`: retry classification for recoverable chat failures and abort/cancel detection.
- `src/modules/agent/runtimeIds.ts`: runtime ID generation for sessions and diagnostics.

Tests for these behaviors should import these pure modules directly. Do not add new test-only exports to `section.ts` or `preferenceScript.ts` for logic that can live in a pure module.

### Provider layer

Primary file: `src/modules/agent/provider.ts`.

Current provider behavior:

- Supports OpenAI-compatible providers.
- Tries streaming first.
- Handles `responses` and `chat.completions` style endpoints.
- Probes endpoint candidates from the user-supplied Base URL.
- Remembers successful endpoint hints in Zotero prefs.
- Falls back only for compatible/recoverable failures before output starts.
- Does not fall back on invalid API keys.
- Parses common streaming delta shapes.
- Sends reasoning effort when the selected model/provider declares support.

Product rule: use the user's Base URL as the source of truth. Do not blindly append one fixed path to every provider. Many third-party gateways use different path rules.

### Model metadata

Primary file: `src/modules/agent/modelMetadata.ts`.

Model list fetching expects OpenAI-compatible JSON from `/models`.

Model metadata can provide:

- Model IDs.
- Context window fields such as `context_length` or `max_model_len`.
- Reasoning effort fields such as `reasoning_efforts`, `supported_reasoning_efforts`, or `reasoning.efforts`.

If the provider does not declare reasoning efforts, the UI should show default only. Do not invent unsupported reasoning levels.

### Zotero context

Primary file: `src/modules/agent/context.ts`.

Supported context:

- Current item metadata.
- Notes.
- PDF annotations.
- Selected text from Zotero reader.
- User custom context from the chat UI.

Selected text capture happens through Zotero reader event handling in `src/hooks.ts`, then context assembly reads the remembered text.

Context preview uses Zotero's current language. The token budget is an estimate and should be described as an estimate, not exact tokenizer output.

### Prompt templates

Primary file: `src/modules/agent/promptTemplates.ts`.

Current templates:

- General QA.
- Paper summary.
- Method critique.
- Related work.

System prompts identify the assistant as `Zotero-Cat`.

### Preferences pane

Primary files:

- `src/modules/prefsPane.ts`
- `src/modules/preferenceScript.ts`
- `addon/content/preferences.xhtml`
- `addon/locale/en-US/preferences.ftl`
- `addon/locale/zh-CN/preferences.ftl`

Behavior rules:

- Save and Test Connection are separate actions.
- Test Connection must not implicitly save settings.
- Save button should only be active when form state differs from saved state.
- Settings text should be selectable and copyable.
- Save failure should show visible feedback and copyable details.

### API Key storage

Primary file: `src/modules/agent/secureApiKey.ts`.

API keys are stored in Firefox Login Manager. They are keyed by provider and normalized Base URL. Do not store new API keys in plain Zotero prefs.

Older plain-pref migration logic exists for the former `openaiApiKey` path. Current active project prefix is `extensions.zotero.zoterocat`.

### Conversation persistence

Primary file: `src/modules/agent/conversationStore.ts`.

Conversation history is stored as JSON in Zotero prefs:

```text
extensions.zotero.zoterocat.agentConversationStore
```

Payload shape:

```json
{
  "version": 2,
  "active": {},
  "conversations": []
}
```

Persistence limits:

- `MAX_PERSISTED_CONVERSATIONS = 64`
- `MAX_PERSISTED_CONVERSATIONS_PER_SCOPE = 8`
- `MAX_VISIBLE_CONVERSATION_OPTIONS = MAX_PERSISTED_CONVERSATIONS_PER_SCOPE`
- `MAX_PERSISTED_MESSAGES_PER_CONVERSATION = 40`
- `MAX_PERSISTED_MESSAGE_CHARS = 8000`

Storage behavior:

- Scope key isolates conversations by Zotero item.
- Active conversation pointer persists per scope.
- Empty conversations do not persist.
- Custom context does not persist.

## Current Limitations

- The plugin does not provide web search or real-time external tools.
- Custom context clears after Zotero restarts or the plugin reloads.
- History has no search, rename, favorite, pagination, lazy loading, or export.
- Token budget is approximate.
- Model list and reasoning effort support depend on provider metadata.
- Streamed output that has already started will not auto-retry.
- Current UI lives inside Zotero's right item pane and shares space with Zotero's native item details.

## Tests And Validation

Automated tests live under `test/`.

Covered areas:

- Context preview token pressure.
- Endpoint candidate generation.
- Retry logic for parser errors.
- Model list parsing.
- Model context window parsing.
- Provider-declared reasoning effort parsing.
- Custom context scoping.
- Recoverable chat retry behavior.
- Conversation store defensive parsing.
- Streaming delta parsing.
- Startup instance definition.

Pure logic tests should import `modelMetadata.ts`, `conversationStore.ts`, `itemScope.ts`, and `chatRetry.ts` directly. Keep `section.ts` focused on UI/runtime coordination rather than acting as a test utility barrel.

Validation commands:

```bash
npm run lint:check
npm run build
npm test
```

Manual Zotero UI validation lives in:

```text
doc/UI_REGRESSION_CHECKLIST.md
```

Run the manual checklist before release work and record Zotero version, OS, date, provider, and result.

## CI

Workflow file: `.github/workflows/ci.yml`.

Jobs:

- `lint`: checkout, setup Node from `.nvmrc`, `npm ci`, `npm run lint:check`.
- `build`: checkout, setup Node from `.nvmrc`, `npm ci`, `npm run build`, upload `.scaffold/build`.
- `test`: checkout, setup Node from `.nvmrc`, `npm ci`, `npm test`.

Do not go back to relying on `zotero-plugin-dev/workflows/setup-js@main` unless the action is pinned and its Node behavior is verified.

## Important Files

- `package.json`: package metadata, add-on identity, scripts, Node engine.
- `zotero-plugin.config.ts`: scaffold config and generated script path.
- `src/modules/agent/section.ts`: item-pane UI and runtime coordination.
- `src/modules/agent/types.ts`: shared agent message types.
- `src/modules/agent/modelMetadata.ts`: model endpoint and metadata parsing.
- `src/modules/agent/conversationStore.ts`: session history parsing and persistence serialization.
- `src/modules/agent/itemScope.ts`: item scope keys.
- `src/modules/agent/chatRetry.ts`: chat retry and abort classification.
- `src/modules/agent/runtimeIds.ts`: runtime ID generation.
- `src/modules/agent/provider.ts`: model provider behavior.
- `src/modules/agent/context.ts`: Zotero context collection.
- `src/modules/agent/promptTemplates.ts`: localized prompt templates.
- `src/modules/agent/secureApiKey.ts`: API Key storage.
- `src/modules/preferenceScript.ts`: settings page logic.
- `addon/prefs.js`: default pref values before scaffold prefixing.
- `addon/content/zoteroPane.css`: item-pane UI styles.
- `addon/content/icons/*`: icon and logo assets.
- `addon/locale/en-US/*`: English Fluent strings.
- `addon/locale/zh-CN/*`: Chinese Fluent strings.
- `test/*`: automated tests.
- `doc/UI_REGRESSION_CHECKLIST.md`: manual UI checklist.

## Next Phase

Phase 4 should ship the first installable release candidate.

Recommended order:

1. Run the UI checklist on Zotero 9 stable.
2. Test the latest Zotero beta if available.
3. Build an XPI and install it through Zotero Add-ons Manager.
4. Confirm settings, API Key storage, and conversation persistence after packaged install.
5. Add `CHANGELOG.md` and versioning rules.
6. Test GitHub release workflow.
7. Add screenshots and installation instructions to README.
8. Add public contact and security email after Zoho Mail is configured for `zoterocat.org`.

## Editing Notes For Future Agents

- Preserve user changes. The worktree may be dirty.
- Keep `section.ts` focused on UI/runtime coordination. New provider-independent logic should usually go into a small pure module under `src/modules/agent/`.
- Keep provider behavior conservative. Third-party gateways differ, so avoid hard-coded endpoint assumptions.
- Keep UI changes compatible with Zotero's native item pane.
- Use official Zotero/plugin-template APIs where possible.
- Run `npm run lint:check`, `npm run build`, and `npm test` after behavior changes.
