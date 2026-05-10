# Changelog

[English](./CHANGELOG.md) | [中文](./CHANGELOG.zh-CN.md)

All notable project changes are tracked here. Zotero-Cat uses `0.x`
versions until the first public stability commitment.

## [0.1.2] - 2026-05-10

### Changed

- Extracted shared text utilities (`collapseWhitespace`, `stripHTML`, `truncate`,
  etc.) to `src/utils/text.ts`, consolidating duplicated implementations across
  `context.ts`, `webSearch.ts`, `toolAction.ts`, `provider.ts`, and `section.ts`.
- Extracted Markdown-to-DOM rendering (~230 lines) from `section.ts` into
  `src/modules/agent/markdown.ts`.
- ESLint `no-unused-vars` rule changed from `off` to `warn`.
- `section.ts` size reduced by removing the inlined Markdown renderer and
  duplicated utility functions.
- Added periodic expired-entry cleanup for the selected-text cache in
  `context.ts`.
- Added a Zotero 10 `Components.Constructor` compatibility verification item
  to the project phase plan.

## [0.1.1] - 2026-05-09

### Added

- Optional web search tool flow with DuckDuckGo, DuckDuckGo HTML fallback, and
  SearXNG JSON support.
- Tool-action registry and parser for model-emitted JSON actions such as web
  search requests.
- Per-item custom context persistence through `customContextStore`.
- Conversation export, rename, and favorite controls.

### Changed

- Expanded selected-text, note, annotation, and system-context budgets to reduce
  premature prompt truncation.
- README, TODO, privacy notes, and implementation handoff docs now describe the
  current release state and local storage behavior.
- Package version is bumped to `0.1.1` so users who installed the earlier
  `v0.1.0-alpha` pre-release receive a real package-version upgrade.

## [0.1.0-alpha] - 2026-05-03

### Added

- Zotero item-pane assistant section with localized chat UI.
- OpenAI-compatible provider support with streaming output, endpoint probing,
  endpoint fallback, model list fetching, and provider-declared reasoning
  effort controls.
- Zotero context injection for item metadata, notes, PDF annotations, selected
  PDF text, and request-scoped custom context.
- Per-item conversation history with Zotero-pref persistence, active session
  tracking, and hard capacity limits.
- API Key storage through Firefox Login Manager.
- Diagnostics panel for retry, model-list, timeout, cancellation, and provider
  errors.
- Shared pure-logic modules for model metadata parsing, conversation storage,
  item scoping, retry classification, runtime IDs, and agent message types.
- Automated tests for provider fallback, model probing, context preview,
  conversation persistence parsing, streaming delta parsing, and startup.
- Release documentation for installation, provider setup, privacy, versioning,
  tagging, and manual compatibility gates.

### Changed

- Packaged add-on compatibility is restricted to Zotero 9 for the initial
  alpha: `strict_min_version` is `9.0` and `strict_max_version` is
  `9.*`.
- GitHub release workflow now runs lint, build, tests, and artifact upload
  directly in this repository before publishing on `v*` tags.

### Release Notes

- Zotero 10 beta compatibility is intentionally not declared until the manual
  UI checklist has been run against the current Zotero beta line.
- Packaged-XPI install and persistence checks must be recorded before a public
  GitHub release is tagged.
