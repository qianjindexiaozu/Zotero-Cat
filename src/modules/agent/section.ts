import { getLocaleID, getString } from "../../utils/locale";
import { AgentMessage, createProviderFromPrefs } from "./provider";

let registeredSectionID: string | false = false;
const TYPEWRITER_STEP_CHARS = 3;
const TYPEWRITER_DELAY_MS = 18;
const SCROLL_BOTTOM_THRESHOLD_PX = 24;
const INLINE_MARKDOWN_PATTERN =
  /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
const MARKDOWN_BLOCK_START_PATTERN = /^(#{1,6}\s+|```|>\s?|[-*+]\s+|\d+\.\s+)/;

interface ScrollState {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

interface AgentRuntime {
  messages: AgentMessage[];
  sending: boolean;
  streamingAssistantIndex: number | null;
  thinkingAssistantIndex: number | null;
  thinkingStep: number;
  thinkingToken: number;
  requestToken: number;
  cancelRequested: boolean;
  cancelActiveRequest: (() => void) | null;
  shouldAutoScroll: boolean;
  refreshers: Map<string, () => Promise<void>>;
}

const runtime: AgentRuntime = {
  messages: [],
  sending: false,
  streamingAssistantIndex: null,
  thinkingAssistantIndex: null,
  thinkingStep: 0,
  thinkingToken: 0,
  requestToken: 0,
  cancelRequested: false,
  cancelActiveRequest: null,
  shouldAutoScroll: true,
  refreshers: new Map(),
};

export function registerAgentSection() {
  if (registeredSectionID) {
    return registeredSectionID;
  }
  registeredSectionID = Zotero.ItemPaneManager.registerSection({
    paneID: "zotero-agent",
    pluginID: addon.data.config.addonID,
    header: {
      l10nID: getLocaleID("item-section-agent-head-text"),
      icon: `chrome://${addon.data.config.addonRef}/content/icons/icon-16.png`,
    },
    sidenav: {
      l10nID: getLocaleID("item-section-agent-sidenav-tooltip"),
      icon: `chrome://${addon.data.config.addonRef}/content/icons/icon-20.png`,
    },
    onInit: ({ paneID, refresh }) => {
      runtime.refreshers.set(paneID, refresh);
    },
    onDestroy: ({ paneID }) => {
      runtime.refreshers.delete(paneID);
    },
    onItemChange: ({ setEnabled }) => {
      setEnabled(true);
      return true;
    },
    onRender: ({ body }) => {
      renderSectionBody(body);
    },
  });
  return registeredSectionID;
}

export function unregisterAgentSection() {
  if (!registeredSectionID) {
    return;
  }
  Zotero.ItemPaneManager.unregisterSection(registeredSectionID);
  registeredSectionID = false;
  runtime.refreshers.clear();
}

function renderSectionBody(body: HTMLDivElement) {
  const doc = body.ownerDocument;
  if (!doc) {
    return;
  }
  const previousMessages =
    body.querySelector<HTMLDivElement>(".za-agent-messages");
  const previousScrollState = previousMessages
    ? captureScrollState(previousMessages)
    : null;
  if (previousMessages) {
    runtime.shouldAutoScroll =
      runtime.sending || isNearBottom(previousMessages);
  }

  const root = doc.createElement("div");
  root.className = "za-agent-root";
  const fixedHeight = computeFixedRootHeight(body);
  root.style.height = `${fixedHeight}px`;
  root.style.minHeight = `${fixedHeight}px`;
  root.style.maxHeight = `${fixedHeight}px`;

  const messages = doc.createElement("div");
  messages.className = "za-agent-messages";
  if (!runtime.messages.length) {
    const empty = doc.createElement("div");
    empty.className = "za-agent-empty";
    empty.textContent = getString("agent-empty-state");
    messages.appendChild(empty);
  } else {
    for (const [index, message] of runtime.messages.entries()) {
      const bubble = doc.createElement("div");
      bubble.className = `za-agent-message za-agent-${message.role}`;
      if (index === runtime.streamingAssistantIndex) {
        bubble.classList.add("za-agent-streaming");
      }
      if (index === runtime.thinkingAssistantIndex) {
        bubble.classList.add("za-agent-thinking");
        bubble.textContent = `${getString("agent-thinking-label")}${".".repeat(runtime.thinkingStep + 1)}`;
      } else {
        renderMessageMarkdown(bubble, message.content);
      }
      messages.appendChild(bubble);
    }
  }
  messages.addEventListener("scroll", () => {
    if (runtime.sending) {
      return;
    }
    runtime.shouldAutoScroll = isNearBottom(messages);
  });

  const composer = doc.createElement("div");
  composer.className = "za-agent-composer";

  const input = doc.createElement("input");
  input.className = "za-agent-input";
  input.type = "text";
  input.placeholder = getString("agent-input-placeholder");
  input.disabled = runtime.sending;

  const sendButton = doc.createElement("button");
  sendButton.className = "za-agent-send";
  sendButton.classList.add(runtime.sending ? "is-stop" : "is-send");
  const buttonLabel = runtime.sending
    ? getString("agent-stop-tooltip")
    : getString("agent-send-tooltip");
  sendButton.title = buttonLabel;
  sendButton.setAttribute("aria-label", buttonLabel);

  sendButton.addEventListener("click", () => {
    if (runtime.sending) {
      requestCancel();
      return;
    }
    const prompt = input.value.trim();
    if (!prompt) {
      return;
    }
    runtime.sending = true;
    runtime.cancelRequested = false;
    runtime.cancelActiveRequest = null;
    runtime.requestToken += 1;
    const requestToken = runtime.requestToken;
    runtime.messages.push({
      role: "user",
      content: prompt,
    });
    const requestMessages = runtime.messages.slice();
    const assistantMessageIndex =
      runtime.messages.push({
        role: "assistant",
        content: "",
      }) - 1;
    runtime.shouldAutoScroll = true;
    runtime.streamingAssistantIndex = null;
    startThinkingAnimation(assistantMessageIndex);
    input.value = "";
    void refreshAllSections();
    void sendMessage(
      requestMessages,
      assistantMessageIndex,
      requestToken,
    ).finally(() => {
      if (requestToken !== runtime.requestToken) {
        return;
      }
      stopThinkingAnimation();
      runtime.streamingAssistantIndex = null;
      runtime.sending = false;
      runtime.cancelRequested = false;
      runtime.cancelActiveRequest = null;
      void refreshAllSections();
    });
  });

  input.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendButton.click();
    }
  });

  composer.append(input, sendButton);
  root.append(messages, composer);
  body.replaceChildren(root);
  if (runtime.shouldAutoScroll || runtime.sending) {
    scrollToBottom(messages);
    return;
  }
  if (previousScrollState) {
    restoreScrollPosition(messages, previousScrollState);
  }
}

async function sendMessage(
  requestMessages: AgentMessage[],
  assistantMessageIndex: number,
  requestToken: number,
) {
  try {
    const provider = createProviderFromPrefs();
    const reply = await provider.chat(requestMessages, {
      onCanceller(cancel) {
        if (requestToken !== runtime.requestToken) {
          return;
        }
        runtime.cancelActiveRequest = cancel;
        if (runtime.cancelRequested) {
          cancel();
        }
      },
    });
    if (requestToken !== runtime.requestToken) {
      return;
    }
    stopThinkingAnimation();
    runtime.streamingAssistantIndex = assistantMessageIndex;
    await streamAssistantReply(assistantMessageIndex, reply);
  } catch (error) {
    if (requestToken !== runtime.requestToken) {
      return;
    }
    stopThinkingAnimation();
    const assistantMessage = runtime.messages[assistantMessageIndex];
    if (!assistantMessage) {
      return;
    }
    runtime.streamingAssistantIndex = null;
    if (runtime.cancelRequested || isAbortError(error)) {
      assistantMessage.content = getString("agent-cancelled");
      await refreshAllSections();
      return;
    }
    assistantMessage.content = `[${getString("agent-error-prefix")}] ${formatError(error)}`;
    await refreshAllSections();
  }
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function refreshAllSections() {
  await Promise.all(
    [...runtime.refreshers.values()].map(async (refresh) => {
      await refresh();
    }),
  );
}

async function streamAssistantReply(
  assistantMessageIndex: number,
  fullReply: string,
) {
  const message = runtime.messages[assistantMessageIndex];
  if (!message) {
    return;
  }
  const chunks = [...fullReply];
  let cursor = 0;
  while (cursor < chunks.length) {
    cursor = Math.min(cursor + TYPEWRITER_STEP_CHARS, chunks.length);
    const current = runtime.messages[assistantMessageIndex];
    if (!current) {
      return;
    }
    current.content = chunks.slice(0, cursor).join("");
    await refreshAllSections();
    if (cursor < chunks.length) {
      await Zotero.Promise.delay(TYPEWRITER_DELAY_MS);
    }
  }
}

function isNearBottom(messages: HTMLDivElement) {
  const distance =
    messages.scrollHeight - (messages.scrollTop + messages.clientHeight);
  return distance <= SCROLL_BOTTOM_THRESHOLD_PX;
}

function scrollToBottom(messages: HTMLDivElement) {
  messages.scrollTop = messages.scrollHeight;
  const view = messages.ownerDocument?.defaultView;
  if (!view) {
    return;
  }
  view.requestAnimationFrame(() => {
    messages.scrollTop = messages.scrollHeight;
  });
  view.setTimeout(() => {
    messages.scrollTop = messages.scrollHeight;
  }, 24);
}

function captureScrollState(messages: HTMLDivElement): ScrollState {
  return {
    scrollTop: messages.scrollTop,
    scrollHeight: messages.scrollHeight,
    clientHeight: messages.clientHeight,
  };
}

function restoreScrollPosition(messages: HTMLDivElement, state: ScrollState) {
  const previousDistanceFromBottom = Math.max(
    0,
    state.scrollHeight - (state.scrollTop + state.clientHeight),
  );
  messages.scrollTop = Math.max(
    0,
    messages.scrollHeight - messages.clientHeight - previousDistanceFromBottom,
  );
}

function computeFixedRootHeight(body: HTMLDivElement) {
  const doc = body.ownerDocument;
  if (!doc) {
    return 360;
  }
  const paneContent = doc.getElementById(
    "zotero-item-pane-content",
  ) as HTMLElement | null;
  const baseHeight = firstPositive(
    paneContent?.clientHeight,
    body.parentElement?.clientHeight,
    body.clientHeight,
    doc.defaultView ? Math.floor(doc.defaultView.innerHeight * 0.75) : 0,
  );
  return Math.max(220, Math.floor(baseHeight * 0.75));
}

function firstPositive(...values: Array<number | undefined>) {
  for (const value of values) {
    if (typeof value === "number" && value > 0) {
      return value;
    }
  }
  return 480;
}

function requestCancel() {
  if (!runtime.sending) {
    return;
  }
  runtime.cancelRequested = true;
  if (runtime.cancelActiveRequest) {
    runtime.cancelActiveRequest();
  }
}

function startThinkingAnimation(assistantMessageIndex: number) {
  runtime.thinkingAssistantIndex = assistantMessageIndex;
  runtime.thinkingStep = 0;
  runtime.thinkingToken += 1;
  const token = runtime.thinkingToken;
  void runThinkingLoop(token);
}

function stopThinkingAnimation() {
  runtime.thinkingAssistantIndex = null;
  runtime.thinkingStep = 0;
  runtime.thinkingToken += 1;
}

async function runThinkingLoop(token: number) {
  while (
    runtime.thinkingAssistantIndex !== null &&
    runtime.thinkingToken === token &&
    runtime.sending
  ) {
    runtime.thinkingStep = (runtime.thinkingStep + 1) % 3;
    await refreshAllSections();
    await Zotero.Promise.delay(320);
  }
}

function isAbortError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return /cancel|abort/i.test(text);
}

function renderMessageMarkdown(container: HTMLDivElement, source: string) {
  const doc = container.ownerDocument;
  if (!doc) {
    container.textContent = source;
    return;
  }
  const fragment = doc.createDocumentFragment();
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith("```")) {
      index = appendCodeBlock(fragment, lines, index, doc);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const headingLevel = Math.min(6, headingMatch[1].length);
      const heading = doc.createElement(`h${headingLevel}`);
      appendInlineMarkdown(heading, headingMatch[2], doc);
      fragment.appendChild(heading);
      index += 1;
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      index = appendListBlock(fragment, lines, index, doc, false);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      index = appendListBlock(fragment, lines, index, doc, true);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      index = appendQuoteBlock(fragment, lines, index, doc);
      continue;
    }

    index = appendParagraphBlock(fragment, lines, index, doc);
  }

  if (!fragment.childNodes.length) {
    const paragraph = doc.createElement("p");
    paragraph.textContent = "";
    fragment.appendChild(paragraph);
  }
  container.replaceChildren(fragment);
}

function appendCodeBlock(
  fragment: DocumentFragment,
  lines: string[],
  start: number,
  doc: Document,
) {
  let cursor = start + 1;
  const codeLines: string[] = [];
  while (cursor < lines.length && !lines[cursor].trim().startsWith("```")) {
    codeLines.push(lines[cursor]);
    cursor += 1;
  }
  const pre = doc.createElement("pre");
  const code = doc.createElement("code");
  code.textContent = codeLines.join("\n");
  pre.appendChild(code);
  fragment.appendChild(pre);
  if (cursor < lines.length) {
    cursor += 1;
  }
  return cursor;
}

function appendListBlock(
  fragment: DocumentFragment,
  lines: string[],
  start: number,
  doc: Document,
  ordered: boolean,
) {
  const list = doc.createElement(ordered ? "ol" : "ul");
  const pattern = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/;
  let cursor = start;
  while (cursor < lines.length && pattern.test(lines[cursor])) {
    const item = doc.createElement("li");
    appendInlineMarkdown(item, lines[cursor].replace(pattern, ""), doc);
    list.appendChild(item);
    cursor += 1;
  }
  fragment.appendChild(list);
  return cursor;
}

function appendQuoteBlock(
  fragment: DocumentFragment,
  lines: string[],
  start: number,
  doc: Document,
) {
  const quote = doc.createElement("blockquote");
  const quoteLines: string[] = [];
  let cursor = start;
  while (cursor < lines.length && /^\s*>\s?/.test(lines[cursor])) {
    quoteLines.push(lines[cursor].replace(/^\s*>\s?/, ""));
    cursor += 1;
  }
  const paragraph = doc.createElement("p");
  appendInlineMarkdown(paragraph, quoteLines.join("\n"), doc);
  quote.appendChild(paragraph);
  fragment.appendChild(quote);
  return cursor;
}

function appendParagraphBlock(
  fragment: DocumentFragment,
  lines: string[],
  start: number,
  doc: Document,
) {
  const paragraphLines: string[] = [];
  let cursor = start;
  while (
    cursor < lines.length &&
    lines[cursor].trim() &&
    !MARKDOWN_BLOCK_START_PATTERN.test(lines[cursor].trim())
  ) {
    paragraphLines.push(lines[cursor]);
    cursor += 1;
  }
  const paragraph = doc.createElement("p");
  appendInlineMarkdown(paragraph, paragraphLines.join("\n"), doc);
  fragment.appendChild(paragraph);
  return cursor;
}

function appendInlineMarkdown(node: HTMLElement, text: string, doc: Document) {
  INLINE_MARKDOWN_PATTERN.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null = null;
  while ((match = INLINE_MARKDOWN_PATTERN.exec(text))) {
    appendTextWithBreaks(node, text.slice(cursor, match.index), doc);
    const [full, linkText, linkHref, inlineCode, boldText, italicText] = match;
    if (linkText && linkHref) {
      const safeHref = normalizeLink(linkHref);
      if (!safeHref) {
        appendTextWithBreaks(node, full, doc);
      } else {
        const anchor = doc.createElement("a");
        anchor.href = safeHref;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.textContent = linkText;
        node.appendChild(anchor);
      }
    } else if (inlineCode) {
      const code = doc.createElement("code");
      code.textContent = inlineCode;
      node.appendChild(code);
    } else if (boldText) {
      const strong = doc.createElement("strong");
      strong.textContent = boldText;
      node.appendChild(strong);
    } else if (italicText) {
      const em = doc.createElement("em");
      em.textContent = italicText;
      node.appendChild(em);
    } else {
      appendTextWithBreaks(node, full, doc);
    }
    cursor = INLINE_MARKDOWN_PATTERN.lastIndex;
  }
  appendTextWithBreaks(node, text.slice(cursor), doc);
}

function appendTextWithBreaks(node: HTMLElement, text: string, doc: Document) {
  if (!text) {
    return;
  }
  const segments = text.split("\n");
  for (const [index, segment] of segments.entries()) {
    if (segment) {
      node.appendChild(doc.createTextNode(segment));
    }
    if (index < segments.length - 1) {
      node.appendChild(doc.createElement("br"));
    }
  }
}

function normalizeLink(href: string) {
  try {
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
    return "";
  } catch (_error) {
    return "";
  }
}
