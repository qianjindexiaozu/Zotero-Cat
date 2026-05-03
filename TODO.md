# TODO - Zotero-Cat

[English](./TODO.md) | [中文](./TODO.zh-CN.md)

This file tracks the project plan by phase. Keep it practical: each checked item should correspond to implemented code, a committed document, or a verified workflow.

## Current Project State

- Project name: `Zotero-Cat`
- Package name: `zotero-cat`
- Plugin ID: `zotero-cat@qianjindexiaozu.dev`
- Namespace / chrome path: `zoterocat`
- Global Zotero instance: `Zotero.ZoteroCat`
- Pref prefix: `extensions.zotero.zoterocat`
- License: `AGPL-3.0-or-later`
- Runtime for development: Node.js 24 LTS
- Current implementation target: Zotero 9

## Phase 0: Repository Initialization

- [x] Choose and declare open-source license: `AGPL-3.0-or-later`.
- [x] Create base docs: `README.md`, `CONTRIBUTING.md`, `TODO.md`.
- [x] Initialize Zotero plugin scaffold with Zotero 9 compatibility target.
- [x] Create repository-local Codex helper plugin skeletons: `zotero-dev`, `llm-provider-test`.
- [x] Rename project to Zotero-Cat across package metadata, plugin metadata, localization, prompt identity, docs, and Git remote.
- [x] Add Node version files: `.nvmrc`, `.node-version`.

## Phase 1: MVP

Goal: load inside Zotero, render a usable assistant panel, and send a basic model request through a configurable provider.

- [x] Register a Zotero item-pane section through `ItemPaneManager.registerSection`.
- [x] Render basic chat UI with message list, input, and send button.
- [x] Add fixed-height chat layout with bottom composer.
- [x] Create Provider abstraction: `provider -> chat`.
- [x] Implement first OpenAI-compatible provider.
- [x] Add configurable Provider, Base URL, model, and API Key settings.
- [x] Add Provider dropdown and common provider presets.
- [x] Separate Save Settings from Test Connection.
- [x] Store API Key through Firefox Login Manager.
- [x] Add localized UI text for Chinese and English Zotero.

## Phase 2: Zotero Context

Goal: make responses useful for reading and reviewing Zotero items without forcing users to paste context by hand.

- [x] Inject current item metadata: title, creators, year, DOI, URL, abstract where available.
- [x] Inject optional notes.
- [x] Inject optional PDF annotations.
- [x] Capture selected text from Zotero PDF reader selection popup.
- [x] Add prompt template system.
- [x] Add context preview.
- [x] Add token budget estimate.
- [x] Show model context window when provider metadata declares it.
- [x] Add user custom context input.
- [x] Keep provided Zotero context read-only in preview.
- [x] Keep custom context folded until clicked.

## Phase 3: Experience Enhancements

Goal: make the assistant feel usable across repeated reading sessions.

- [x] Stream assistant output.
- [x] Render incremental output in a typewriter-like flow.
- [x] Add request cancellation.
- [x] Show send icon and stop icon based on request state.
- [x] Add tooltip for send and stop buttons.
- [x] Add request timeout: 60 seconds.
- [x] Probe third-party endpoint paths and remember successful path hints.
- [x] Fetch model list from OpenAI-compatible `/models` endpoint.
- [x] Add model selection and custom model input in the chat area.
- [x] Add reasoning effort selection based on provider-declared model metadata.
- [x] Add copy button and visible copy feedback.
- [x] Add retry policy for recoverable request errors before output starts.
- [x] Add per-item history sessions with native dropdown.
- [x] Add new session, clear session, and delete session actions.
- [x] Persist conversation history in Zotero prefs.
- [x] Store active conversation pointer per item.
- [x] Enforce history capacity limits.
- [x] Add `Thinking.` / `Thinking..` / `Thinking...` waiting animation.
- [x] Show response wait time based on local send-to-first-output timing.
- [x] Keep chat window fixed at 90 percent height.
- [x] Keep input composer at the bottom.
- [x] Auto-scroll during normal streaming without jumping back to top after completion.
- [x] Render assistant Markdown safely.
- [x] Add diagnostics panel for retry and request errors.

## Phase 3.5: Engineering Quality

Goal: reduce regression risk before packaging and public release work.

- [x] Add Provider endpoint fallback unit tests.
- [x] Add model list probing and connection parsing unit tests.
- [x] Add context preview/token estimate tests.
- [x] Add conversation persistence parser tests.
- [x] Add startup scaffold test.
- [x] Add Zotero UI manual regression checklist: `doc/UI_REGRESSION_CHECKLIST.md`.
- [x] Make `npm test` exit after completion with `--exit-on-finish`.
- [x] Update CI to use `.nvmrc` through `actions/setup-node@v4`.
- [x] Use `npm ci` in CI jobs.
- [x] Extract model metadata parsing, conversation persistence, item scoping, chat retry classification, and shared agent message types from the item-pane UI module.
- [x] Remove duplicated model-list parser logic between chat UI and preferences Test Connection.
- [x] Point pure logic tests directly at pure modules instead of test-only UI exports.

## Phase 4: Compatibility And Release

Goal: produce an installable XPI and make the project usable by people outside the local development machine.

Repository-side release preparation is complete. GUI and packaged-install checks remain manual release gates and must be recorded before tagging a public release.

- [ ] Run `doc/UI_REGRESSION_CHECKLIST.md` against Zotero 9 current stable build.
- [ ] Record manual regression result with Zotero version, OS, date, and provider used.
- [ ] Verify the latest Zotero beta or next major pre-release if available.
- [x] Confirm `strict_min_version` and `strict_max_version` before first release.
- [x] Build XPI artifact locally.
- [ ] Verify the XPI can be installed through Zotero Add-ons Manager.
- [ ] Verify settings and conversation persistence after installing packaged XPI.
- [x] Add `CHANGELOG.md`.
- [x] Define versioning policy for `0.x` releases.
- [x] Define release branch/tag naming.
- [x] Add dry-run path for GitHub release workflow.
- [x] Add installation instructions and screenshot capture requirements.
- [x] Add provider setup examples for OpenAI-compatible services.
- [x] Add privacy and data-storage notes for users.
- [x] Add Zotero trademark/non-affiliation disclaimer to public pages.
- [x] Provide English and Chinese versions for public user-facing Markdown files.
- [x] Record automated local release verification with XPI hash.

## Phase 5: Public Product Polish

Goal: prepare for GitHub stars, early users, and issue reports without overbuilding.

- [ ] Create project website at `zoterocat.org` or redirect it to the GitHub repo first.
- [ ] Add a concise product screenshot to README.
- [ ] Add a short demo GIF or video.
- [ ] Add issue templates for bug report, provider compatibility, and feature request.
- [ ] Add security contact: `security@zoterocat.org` after mail setup.
- [ ] Add support/contact email: `contact@zoterocat.org`.
- [ ] Add GitHub repository topics.
- [ ] Add a short architecture document if contributors start asking for internals.
- [ ] Prepare launch notes for Zotero community channels.

## Backlog

These are useful but not part of the current release path.

- [ ] Optional web search tool integration.
- [ ] Persistent custom context per item.
- [ ] Conversation export.
- [ ] Conversation rename or favorite.
- [ ] More provider-specific adapters if OpenAI-compatible behavior is insufficient.
- [ ] Better token counting with provider/model-specific tokenizers.
- [ ] UI tests beyond scaffold startup if Zotero automation becomes stable enough.
