# Zotero-Cat

Zotero-Cat is a Zotero sidebar assistant for reading, summarizing, reviewing, and discussing research items with user-selected model providers. It follows the interaction style of Codex in VS Code, but keeps the provider configurable so users can use OpenAI-compatible gateways, local services, or self-hosted model endpoints.

The name comes from a cat downstairs in the dorm that helps people find things, and from the Linux `cat` command that reads content out loud enough for a pipeline to use.

Zotero-Cat is an independent open-source project and is not affiliated with Zotero.

## Current Status

The project is in pre-release development. Phase 1, Phase 2, Phase 3, and Phase 3.5 are complete. The next major work is Phase 4: compatibility verification, packaging, release workflow, and public launch preparation.

The plugin currently runs as a Zotero item-pane section through `ItemPaneManager.registerSection`. It does not replace Zotero's native right sidebar.

## Implemented Features

- Zotero right-pane `Zotero-Cat` section with icon and localized labels.
- Fixed-height chat panel with bottom input composer.
- Streaming-first assistant output with incremental rendering.
- Send button that switches to a stop button during active requests.
- `Thinking.` / `Thinking..` / `Thinking...` waiting animation.
- Response wait time shown in assistant message metadata.
- Markdown rendering for assistant messages.
- Message selection and copy button with visible copy feedback.
- Provider settings page with Provider, Base URL, API Key, Save, and Test Connection.
- API Key storage through Firefox Login Manager, not plain Zotero prefs.
- OpenAI-compatible request support for `responses` and `chat.completions` endpoints.
- Endpoint probing, stream-first fallback, and successful endpoint path memory.
- Model list fetching from provider `/models` endpoint.
- Model selection, custom model input, and provider-declared reasoning effort selection.
- Zotero context injection for metadata, notes, annotations, and selected PDF text.
- Read-only context preview with token budget estimate and model context window hint.
- Folded custom context input for user-supplied context per item.
- Per-item conversation history with native dropdown, new session, clear, and delete.
- Conversation persistence in Zotero prefs with hard capacity limits.
- Diagnostics panel for retries, model list failures, and final request errors.
- Shared pure-logic modules for model metadata parsing, conversation storage, item scoping, and retry decisions.
- Unit tests for provider fallback, model probing, context preview, persistence parsing, and startup.
- Zotero UI manual regression checklist for release verification.

## Technology

- Zotero plugin scaffold: `zotero-plugin-scaffold`
- Base template lineage: `windingwind/zotero-plugin-template`
- UI/runtime language: TypeScript
- Zotero target: Zotero 9 and forward-compatible higher versions where possible
- Node runtime: Node.js 24 LTS
- Package manager: npm
- License: `AGPL-3.0-or-later`

## Requirements

- macOS or another Zotero-supported desktop platform
- Zotero 9 for current development validation
- Node.js 24 LTS
- npm
- A model provider endpoint if you want live chat responses

The repository contains both `.nvmrc` and `.node-version`, each set to `24`.

## Quick Start

1. Switch to the project Node version:

```bash
nvm use
```

If Node 24 is not installed:

```bash
nvm install
```

2. Copy environment configuration:

```bash
cp .env.example .env
```

3. Fill Zotero paths in `.env` if needed by your local scaffold setup.

4. Install dependencies:

```bash
npm install
```

5. Start Zotero with the plugin loaded:

```bash
npm start
```

6. Open Zotero, select an item, and open the `Zotero-Cat` section in the right item pane.

## Provider Configuration

Open Zotero preferences and find the `Zotero-Cat` settings pane.

Configure:

- Provider ID: currently use `openai-compatible` unless testing a preset path.
- Base URL: use the provider's real API base URL, not the website homepage.
- API Key: saved through Firefox Login Manager.
- Test Connection: checks the current form values without saving them.
- Save Settings: persists provider, base URL, and key after explicit user action.

The chat input area can fetch the model list from the provider. Zotero-Cat expects OpenAI-compatible JSON from `/models`. If a provider does not expose model metadata, use a custom model name and default reasoning effort.

## Data Storage

Zotero-Cat stores different data in different places:

- Conversation history: Zotero pref `extensions.zotero.zoterocat.agentConversationStore`.
- Provider, Base URL, selected model, reasoning effort, endpoint hints: Zotero prefs under `extensions.zotero.zoterocat.*`.
- API Key: Firefox Login Manager, scoped by provider and base URL.
- Custom context: runtime memory only, scoped by Zotero item key. It clears after Zotero restarts or the plugin reloads.

Conversation persistence limits:

- Maximum 64 persisted conversations globally.
- Maximum 8 persisted conversations per Zotero item.
- Maximum 40 persisted messages per conversation.
- Maximum 8000 characters per persisted message.

## Development Commands

```bash
npm run lint:check
npm run build
npm test
npm start
```

`npm test` uses `zotero-plugin test --exit-on-finish` so the scaffold test process exits after the suite completes.

## CI And Quality

GitHub Actions uses `.nvmrc` through `actions/setup-node@v4`, installs dependencies with `npm ci`, and runs lint, build, and tests in separate jobs.

Quality entry points:

- Static and formatting check: `npm run lint:check`
- Build and type check: `npm run build`
- Scaffold test suite: `npm test`
- Zotero UI manual regression: [doc/UI_REGRESSION_CHECKLIST.md](./doc/UI_REGRESSION_CHECKLIST.md)

## Repository Layout

- `src/modules/agent/section.ts`: Zotero-Cat item-pane UI, runtime state coordination, and UI events.
- `src/modules/agent/provider.ts`: Provider abstraction, OpenAI-compatible request logic, streaming parser, endpoint probing.
- `src/modules/agent/context.ts`: Zotero metadata, note, annotation, and selected-text context assembly.
- `src/modules/agent/modelMetadata.ts`: Model endpoint candidates, model-list parsing, context-window parsing, and reasoning-effort metadata.
- `src/modules/agent/conversationStore.ts`: Conversation state types, defensive persistence parsing, serialization, and capacity selection.
- `src/modules/agent/itemScope.ts`: Primary Zotero item resolution and per-item scope keys.
- `src/modules/agent/chatRetry.ts`: Chat retry and cancellation classification.
- `src/modules/agent/types.ts`: Shared agent message types.
- `src/modules/agent/promptTemplates.ts`: Prompt templates and localized system prompts.
- `src/modules/agent/secureApiKey.ts`: Firefox Login Manager API Key storage.
- `src/modules/preferenceScript.ts`: Preferences pane behavior.
- `addon/locale/en-US/*` and `addon/locale/zh-CN/*`: Fluent localization files.
- `addon/content/icons/*`: Static icon and logo assets.
- `test/*`: Unit and scaffold tests.
- `doc/UI_REGRESSION_CHECKLIST.md`: Manual Zotero UI release checklist.

## Roadmap

See [TODO.md](./TODO.md) for the detailed phase plan.

Immediate next phase:

- Verify Zotero 9 current stable build manually.
- Verify the latest Zotero beta if available.
- Package an XPI artifact.
- Add a CHANGELOG and release policy.
- Prepare public-facing screenshots, demo GIF, and installation instructions.
