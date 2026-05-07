# Zotero-Cat Design System

The visual + interaction language for **Zotero-Cat** — an open-source Zotero plugin and its bilingual marketing site at [zoterocat.org](https://zoterocat.org).

> Zotero-Cat is a Zotero item-pane assistant for reading, summarizing, reviewing, and discussing research items with user-selected model providers. It follows the interaction style of Codex in VS Code, but keeps the provider configurable.

The product is **independent open source**, **not affiliated with Zotero**, and **bilingual (zh + en)** by default — these three facts shape every design decision in this system.

---

## Sources

This design system was distilled from two repositories the user attached:

| Source                                | Path / URL                                                                                                | What it contributes                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Plugin (TypeScript / Zotero 9 add-on) | `Zotero-Cat/` &nbsp;·&nbsp; `github.com/qianjindexiaozu/Zotero-Cat`                                       | Item-pane chat UI, preferences pane, runtime tokens (`addon/content/zoteroPane.css`), Fluent localization.          |
| Marketing site (Astro 5, SSG)         | `Zotero-Cat-Web/` &nbsp;·&nbsp; `github.com/qianjindexiaozu/Zotero-Cat-Web` &nbsp;·&nbsp; `zoterocat.org` | Public design tokens (`src/styles/tokens.css`), brand iconography, hero / terminal / story sections, content rules. |

The original spec lives at `Zotero-Cat-Web/docs/superpowers/specs/2026-05-04-zoterocat-website-design.md` (not pre-loaded — read on demand).

---

## Two products, one voice

| Surface    | Form factor                                            | Audience              | Tone                              |
| ---------- | ------------------------------------------------------ | --------------------- | --------------------------------- |
| **Plugin** | Compact 360px-tall pane inside Zotero's right item bar | Researchers mid-paper | Functional, terse, runtime        |
| **Web**    | Full-bleed marketing + bilingual docs site             | First-time visitors   | Welcoming, narrative, opinionated |

The plugin is **all chat, no chrome**: a streaming message list, a composer, a context preview, and a tiny diagnostics drawer. The marketing site is **all narrative**: a hero with a typewriter terminal, a feature triad with GIFs, a 4-step quickstart, a provider chip wall, and a "where the name comes from" story block.

---

## Index

```
README.md                  ← you are here
SKILL.md                   ← cross-compatible skill manifest for Claude Code
colors_and_type.css        ← canonical CSS variables — colors, type, spacing, radii, shadows, motion
fonts/                     ← Inter + JetBrains Mono (Google Fonts substitution — see VISUAL FOUNDATIONS)
assets/
  icon-cat-line.svg        ← NEW minimalist line-art cat-with-mortarboard (commissioned this round)
  icon-cat-line-filled.svg ← same lines, orange tassel + nose accent
  wordmark.svg             ← icon + "Zotero-Cat" lockup
  original-icon.svg        ← previous (terminal-window-with-cat-face) icon — kept for reference
  original-favicon.svg     ← previous favicon
  apple-touch-icon.png     ← previous apple-touch-icon raster
  og-default.png           ← OG card raster
  plugin-favicon.png       ← plugin item-pane section icon (16/20px)
  source-tokens.css        ← copy of upstream tokens.css for diffing
preview/                   ← design system cards (registered in the Design System tab)
ui_kits/
  plugin/                  ← Zotero item-pane chat UI recreation
  web/                     ← marketing site (hero / quickstart / feature triad)
```

---

## CONTENT FUNDAMENTALS

The voice is **shy-confident, tools-first, bilingual**. Copy reads like it was written by someone who built the thing themselves, not by a marketing team.

### Tone & person

- **Second person, casual.** "Make your Zotero read, think, talk back." / "让你的 Zotero 会读、会想、会聊。" The product addresses _you_; it never refers to itself in the third person on the marketing surface.
- **Imperative verbs in CTAs.** "Pick a provider", "Paste API Key once", "Start chatting", "5-min start", "Download zotero-cat.xpi". No "Click here", no "Get started for free".
- **Plain in zh, plain in en.** Chinese copy uses everyday language ("不到 5 分钟，你就能开始用") rather than corporate translation Chinese. English copy uses contractions and short sentences ("Disagree with the conclusion? Keep asking.").
- **Self-aware origin story.** The "where the name comes from" section is required canon: a cat downstairs in a dorm + the Linux `cat` command. Lean into it.

### Casing

- **Sentence case everywhere.** Headings, nav, buttons. Never Title Case. `Features`, `Download`, `Guide`, `FAQ`. Even `5-min start`.
- **Compound brand name** is always `Zotero-Cat` (hyphen, capital Z, capital C). Never `Zotero Cat`, `zoterocat` (the domain is the only lowercase exception), or `zotero-cat` (file/CLI exception only).
- **CLI-style flourishes** are lowercase + monospace: `$ cat paper.pdf | zotero-cat --explain`.

### Vocabulary — required

- "Item-pane" (Zotero's term, hyphenated)
- "OpenAI-compatible" (never "OpenAI compatible")
- "API Key" (capital A, capital K — matches the plugin's pref label)
- "Provider" (not "vendor", not "service")
- "Streaming" / "stream-first"
- "Reasoning effort" (provider-declared)

### Vocabulary — banned (per `Zotero-Cat-Web/README.md`, strictly enforced)

| ❌ Don't say                                              | ✅ Say instead                                              |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| Prices, "$", "free", "credits", "cheap"                   | Link to the provider's pricing page                         |
| "Best model", "we recommend GPT-4"                        | Direct readers to the live `/models` list inside the plugin |
| "Works in mainland China", "needs a VPN", "blocked in CN" | Nothing — never mention regions                             |
| "Better than [other Zotero plugin]"                       | Don't reference other plugins at all                        |
| "AI-powered", "leverage", "synergy", "boost productivity" | Concrete verbs: read, summarize, discuss                    |

### Emoji & punctuation

- **No emoji** anywhere — not in copy, not in headings, not in commit messages. The product earns its cuteness through the cat icon, not 🐱.
- **Arrow glyphs** are allowed and encouraged: `→` after primary CTAs, `↗` after external links.
- **Em dashes** (`—`) are used liberally; en dashes are not. Chinese uses `·` (中点) as a separator in footers and inline lists.
- **The `_` underscore** appears as the terminal cursor — keep the typewriter motif intact.

### Examples (verbatim from the codebase)

> Make your Zotero read, think, talk back.
> 让你的 Zotero 会读、会想、会聊。

> Open any PDF, get a summary, key points and open questions in seconds.
> 点开任意 PDF，几秒内拿到中文摘要、要点和疑问。

> Disagree with the conclusion? Keep asking. It carries the paper context across the conversation.
> 不同意它的结论？继续问。它带着这篇文献的上下文跟你聊。

> An independent open-source project, not affiliated with Zotero.
> 一个独立开源项目，与 Zotero 团队无关。

---

## VISUAL FOUNDATIONS

Apple-leaning sensibility — **warm-paper light**, **deep-graphite dark**, one **orange accent**, generous breathing room, restrained motion, soft shadows. Nothing screams.

### Color

Three named brand colors, plus warm neutrals:

| Token                | Hex       | Role                                                                                                            |
| -------------------- | --------- | --------------------------------------------------------------------------------------------------------------- |
| `--brand-orange`     | `#5AA3F5` | Tassel on the cap, primary CTA on dark, terminal cursor, single-color accent                                    |
| `--brand-orange-ink` | `#3D8BFF` | The same accent rendered legibly on the warm-paper light bg (4.6:1) — for link text, focus rings, prose accents |
| `--brand-graphite`   | `#1A1A1F` | Default ink, deep dark surface                                                                                  |
| `--brand-paper`      | `#FFFFFF` | Default light surface — **warm**, not pure white                                                                |
| `--brand-signal`     | `#4ECDC4` | Cyan support color — connection-OK states, second-tier accents (use sparingly)                                  |

**Rules:**

- One accent at a time. Don't pair `--brand-orange` with `--brand-signal` in the same component.
- Light mode is the default. Use `--brand-paper` (warm `#FFFFFF`) — never `#FFF` for page bg.
- Dark mode lifts the orange to `#409CFF` to keep contrast against `#0F0F12`.
- Semantic state colors (`--color-success` `#1F5C23`, `--color-warning` `#8A5A00`, `--color-danger` `#8A1C1C`) are **muted, earthy hex values**, not neon.

### Typography

- **Apple system stack first**, Inter as a web fallback: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Inter', …, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui`. PingFang in front for Chinese.
- **JetBrains Mono** for code, the terminal demo, and runtime numerics ("1/4", "Step 1").
- **Display tracking** is tight (`-0.02em`) at large sizes; body tracking is normal.
- Hero headlines use `clamp(2.5rem, 5vw + 1rem, 6rem)` — they breathe at desktop, fold gracefully on mobile.
- Body is `1rem` (16px) on the plugin and `1.125rem` (18px) on long-form web — the marketing site reads like a generous magazine, the plugin reads like a terminal.
- **Line-height nudge for CJK**: `:lang(zh) { --lh-body: 1.8 }`. Always.

### Spacing

8pt grid: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 80 · 128`. The marketing site favors big jumps (24 → 80 → 128); the plugin compresses to (4 → 6 → 8 → 12). Never invent a one-off `14px`.

### Backgrounds

- **No gradients in product UI.** None. The single exception is the terminal demo's _bar_ (a `color-mix` 5% white tint over the terminal bg) — not a real gradient.
- **No textures, no grain, no noise.** The page is flat warm paper.
- **No full-bleed photography.** GIFs of the actual plugin are the only "imagery"; they live inside `<GifFrame>` cards with a 1px border and the page bg — never full-bleed.
- **No hand-drawn illustrations** beyond the cat icon and its derivatives.

### Animation

- **All motion is small and earned.** `cubic-bezier(0.22, 1, 0.36, 1)` is the standard ease (Apple-style).
- Three durations: `--dur-fast: 140ms` (color/opacity), `--dur-base: 220ms` (component), `--dur-slow: 320ms` (page-level fade-up).
- The hero terminal has a **typewriter** effect on `$ cat paper.pdf | zotero-cat --explain` — guarded by `prefers-reduced-motion: no-preference`.
- The terminal cursor blinks with `step-end` at 800ms — sharp, not smooth.
- Streaming assistant messages get a `▋` block cursor with `step-end` at 800ms — same aesthetic family.
- **Bouncy springs are forbidden.** No `cubic-bezier(.68,-0.55,…)`-style overshoots.
- All keyframes live behind `@media (prefers-reduced-motion: no-preference)`.

### Hover & press states

- **Hover (links / nav)**: color shifts from `--color-fg-muted` to `--color-fg`. Not opacity.
- **Hover (primary button)**: bg flips from `--color-accent` to `--color-fg`, fg flips to `--color-bg`. The button gets _more_ contrast on hover, not less.
- **Hover (ghost / card)**: border darkens from `--color-border` to `--color-border-strong` or `--color-accent`.
- **Press**: `transform: translateY(1px)` — a one-pixel sink. No scale. No ripple.
- **Focus-visible**: 2px outline in `--color-accent-ink`, 2px offset, `--r-sm` rounded. WCAG 2.2 SC 1.4.11 compliant.

### Borders & dividers

- **Hairlines**, always `1px solid var(--color-border)` (`#E6E5DD` light / `#25252B` dark). The header uses `color-mix(…, 60%, transparent)` to feel even more graphite-paper.
- **No double borders, no inset shadows masquerading as borders, no left-accent-bar cards.**

### Shadows

Three tiers, soft and Apple-ish:

| Token               | Value                                                | Use                                          |
| ------------------- | ---------------------------------------------------- | -------------------------------------------- |
| `--shadow-1`        | `0 1px 2px / 0 1px 1px` rgba(20,20,25,0.04)          | Resting cards                                |
| `--shadow-2`        | `0 4px 14px -4px / 0 2px 4px` rgba(20,20,25,0.08)    | Hover cards, dropdowns                       |
| `--shadow-3`        | `0 14px 40px -10px / 0 4px 10px` rgba(20,20,25,0.18) | Modal, popover                               |
| `--shadow-terminal` | `0 30px 60px -30px rgba(0,0,0,0.45)`                 | The hero terminal — the one signature shadow |

Dark mode shadows are heavier-alpha (0.5–0.6) since they're on near-black.

### Transparency & blur

- The sticky site header is the **only** blurred surface: `backdrop-filter: saturate(180%) blur(18px)`, with a `color-mix(…, 75%, transparent)` background. It floats over scroll but doesn't dominate.
- `color-mix(in srgb, currentColor X%, transparent)` is the **canonical** way to get tinted neutrals — used heavily in the plugin's CSS so it inherits Zotero's theme.

### Radii

`4 · 6 · 10 · 14 · 20 · 999`. The plugin runs tight (4–6); the marketing site runs softer (10–16). Pills (`999`) only on chips and the provider grid — never on buttons (buttons are `--r-md` 10px).

### Cards

`background: var(--color-surface)` + `1px` border + `--r-md` (10px) on light / `--r-lg` (14px) for hero-tier cards. Resting shadow is `--shadow-1` or none. Hover lifts to `--shadow-2` and either darkens the border or shifts it to `--color-accent`. **No colored left-bar accent cards.**

### Layout rules

- Three canonical widths: `--w-prose: 720px` (long-form text), `--w-wide: 1080px` (sub-grids), `--w-hero: 1200px` (the hero strip and most marketing sections).
- Sections separate with `padding: var(--sp-10) var(--sp-3)` (80px vertical, 12px gutter on mobile).
- Site header is `position: sticky; top: 0; z-index: 10`. Footer is the only thing that uses `margin-block-start: var(--sp-12)`.

### Imagery vibe

- **Warm**, not cool. The light mode is intentionally tinted (`#FFFFFF` not `#FFF`).
- **No B&W**, **no grain**, **no duotone**.
- **GIFs of the plugin in action** are the only photographic content. They use the actual product UI on a `--color-bg` background — they look like screenshots, not stock.

---

## ICONOGRAPHY

The brand has **one mascot** — the cat in a mortarboard — and **no icon library** beyond what Zotero/Firefox provides at runtime. We don't ship our own icon font.

### The mascot

- **Subject**: a cat's face, front-on, wearing a graduation cap with an orange tassel. The tassel is the single brand-color hit.
- **Old icon** (`assets/original-icon.svg`): a terminal-window background with a detailed cat (round glasses, ears, eyes, nose, mouth, mortarboard). User feedback: _"the icons are ugly — needs a simple line-art front-facing cat-face with a mortarboard, just a few lines."_
- **New icon** (`assets/icon-cat-line.svg` + `…-filled.svg`): minimalist line-art, ~14 strokes, closed happy `^^` eyes, tiny `w` mouth, jaunty cap, curly tassel, faint blush + whisker hints. Stroke `1.8`, `linecap=round`, `linejoin=round`. Renders crisply at 16×16 plugin size and 96×96 hero size. The "filled" variant only colors the tassel + nose + blush in `--brand-orange`; the line variant uses `currentColor` and inherits.

**Substitution flag**: the old terminal-window icon is _kept_ at `assets/original-icon.svg` for reference only — the website (`favicon.svg`, `brand/icon.svg`) should be updated to the new line-art before publishing. The plugin's `addon/content/icons/icon-16.png` / `icon-20.png` rasters need to be re-exported from `icon-cat-line.svg` at the matching sizes; flagged for the user to do, since I don't have a PNG rasterizer in this environment.

### Other iconography

- **Inline UI glyphs** are unicode characters, not SVGs:
  - `→` after primary CTA labels
  - `↗` after external links (`View on GitHub ↗`)
  - `_` as the terminal cursor (animated `step-end` blink)
  - `▋` as the streaming-message cursor
  - `·` as the inline separator (especially in the footer)
  - `➤` (filled triangle) as the send-message button glyph in the plugin
  - `■` as the stop-message button glyph in the plugin
  - `⧉` as the copy-message button glyph; `✓` for "copied" feedback
- **The theme toggle** uses a hand-drawn 24×24 stroke SVG with a sun (visible in light) and a moon (visible in dark). Stroke `1.8`, no fill.
- **Traffic-light dots** appear on the terminal demo and the favicon — `#FF5F57 / #FEBC2E / #28C840`. These are macOS-window decoration, not interactive.
- **No emoji as iconography.** None. (And per Content Fundamentals — none in copy either.)
- **No third-party icon system** is loaded. If a future surface needs more glyphs, the recommendation (flagged for user) is **Lucide** at default `1.5` stroke, switched to `1.8` to match this system. Don't pull in Heroicons (too solid) or FontAwesome (too noisy).

### When to draw vs. when to use unicode

| Need                     | Use                                                                |
| ------------------------ | ------------------------------------------------------------------ |
| The mascot               | `assets/icon-cat-line.svg`                                         |
| A directional arrow      | `→` `↗` `←` (unicode)                                              |
| A status indicator       | A colored dot (`<span style="background: var(--color-success)">`)  |
| A new product affordance | **Stop and ask the user.** Do not invent SVG icons in this system. |

---

## See also

- `SKILL.md` — for using this folder as an Agent Skill in Claude Code.
- `preview/` — every card registered in the Design System tab.
- `ui_kits/plugin/` and `ui_kits/web/` — high-fidelity recreations of both surfaces for prototyping.
