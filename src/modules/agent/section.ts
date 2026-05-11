import { getLocaleID, getString } from "../../utils/locale";
import { getPref, setPref } from "../../utils/prefs";
import {
  AgentContextOptions,
  buildContextPreview,
  buildRequestMessagesWithContext,
  getDefaultContextOptions,
} from "./context";
import type { AgentMessage } from "./types";
import {
  createProviderFromPrefs,
  isApiKeyRequiredForProvider,
} from "./provider";
import { shouldRetryChatError, isAbortError } from "./chatRetry";
import {
  CONVERSATION_STORE_VERSION,
  ConversationState,
  MAX_VISIBLE_CONVERSATION_OPTIONS,
  RuntimeMessage,
  buildActiveConversationStore,
  createConversation,
  parseConversationStorePayload,
  selectConversationsForPersistence,
  serializeConversation,
  touchConversation,
} from "./conversationStore";
import {
  resolveConversationScopeKey,
  resolveCustomContextKey,
} from "./itemScope";
import {
  ReasoningEffortValue,
  buildModelContextMap,
  buildModelEndpointCandidates,
  buildModelReasoningMap,
  buildModelSourceKey,
  canRetryModelEndpoint,
  getDefaultModelForProvider,
  normalizeBaseURL,
  normalizeProviderID,
  normalizeReasoningEffort,
  normalizeString,
  parseModelInfos,
  resolveEffectiveReasoningEffort,
  resolveModelOptions,
  summarizeModelMetadataAvailability,
} from "./modelMetadata";
import {
  DEFAULT_PROMPT_TEMPLATE_ID,
  getPromptTemplateByID,
  getPromptTemplates,
} from "./promptTemplates";
import { createRuntimeID } from "./runtimeIds";
import { getProviderApiKey } from "./secureApiKey";
import { openAgentPreferences } from "../prefsPane";
import { parseAssistantToolActions, executeToolAction } from "./toolAction";
import {
  isAnnotationWriteAction,
  isPdfToolsAutoApplyPref,
  isPdfToolsEnabledPref,
  resolveWriteAction,
} from "./annotationTools";
import {
  acceptAllPending,
  clearBatch,
  createBatch,
  getBatchForConversation,
  hasPendingBatch,
  rejectAllPending,
  setProposalStatus,
  summarizeBatch,
  type AnnotationBatch,
  type AnnotationProposal,
} from "./annotationProposals";
import { renderProposalBatch } from "./proposalView";
import {
  createAnnotation,
  deleteAnnotation,
  updateAnnotation,
  type SaveAnnotationResult,
} from "../tools/pdfAnnotations";
import {
  buildExternalWebSearchContext,
  isWebSearchEnabledPref,
  type WebSearchRunStatus,
} from "./webSearchContext";
import { renderMessageMarkdown } from "./markdown";
import { truncateInline, formatShortDateTime } from "../../utils/text";

let registeredSectionID: string | false = false;
const TYPEWRITER_STEP_CHARS = 3;
const TYPEWRITER_DELAY_MS = 18;
const SCROLL_BOTTOM_THRESHOLD_PX = 24;
const MODEL_FETCH_TIMEOUT_MS = 25_000;
const ROOT_HEIGHT_RATIO = 0.9;
const CHAT_MAX_ATTEMPTS = 2;
const CHAT_RETRY_DELAY_MS = 700;
const MAX_DIAGNOSTIC_ENTRIES = 30;
const resizeObservers = new WeakMap<HTMLDivElement, ResizeObserver>();

interface ScrollState {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

interface MessagePointer {
  conversationKey: string;
  messageIndex: number;
}

interface DiagnosticEntry {
  id: string;
  level: "info" | "warning" | "error";
  createdAt: number;
  message: string;
  detail?: string;
}

interface AgentRuntime {
  conversationsByKey: Map<string, ConversationState>;
  activeConversationKeyByScope: Map<string, string>;
  conversationStoreLoaded: boolean;
  sending: boolean;
  streamingAssistant: MessagePointer | null;
  waitingAssistant: MessagePointer | null;
  waitingStartedAt: number | null;
  waitingStep: number;
  waitingToken: number;
  requestToken: number;
  cancelRequested: boolean;
  cancelActiveRequest: (() => void) | null;
  shouldAutoScroll: boolean;
  templateID: string;
  contextOptions: AgentContextOptions;
  customContextByItemKey: Map<string, string>;
  modelOptionsBySource: Map<string, string[]>;
  modelContextBySource: Map<string, Map<string, number>>;
  modelReasoningBySource: Map<string, Map<string, ReasoningEffortValue[]>>;
  modelFetchBusy: boolean;
  modelFetchStatusMessage: string;
  modelFetchStatusKind: "success" | "error" | "";
  webSearchStatusMessage: string;
  webSearchStatusKind: "success" | "error" | "";
  customContextOpen: boolean;
  contextPreviewOpen: boolean;
  diagnosticsOpen: boolean;
  diagnostics: DiagnosticEntry[];
  refreshers: Map<string, () => Promise<void>>;
  pendingToolFollowUp: Map<string, PendingToolFollowUp>;
  pendingToolStatus: Map<string, string>;
}

interface PendingToolFollowUp {
  requestMessages: AgentMessage[];
  assistantContent: string;
  assistantMessageIndex: number;
  reasoningEffort: ReasoningEffortValue;
  item: Zotero.Item | null;
  readResults: string;
}

const runtime: AgentRuntime = {
  conversationsByKey: new Map(),
  activeConversationKeyByScope: new Map(),
  conversationStoreLoaded: false,
  sending: false,
  streamingAssistant: null,
  waitingAssistant: null,
  waitingStartedAt: null,
  waitingStep: 0,
  waitingToken: 0,
  requestToken: 0,
  cancelRequested: false,
  cancelActiveRequest: null,
  shouldAutoScroll: true,
  templateID: DEFAULT_PROMPT_TEMPLATE_ID,
  contextOptions: getDefaultContextOptions(),
  customContextByItemKey: new Map(),
  modelOptionsBySource: new Map(),
  modelContextBySource: new Map(),
  modelReasoningBySource: new Map(),
  modelFetchBusy: false,
  modelFetchStatusMessage: "",
  modelFetchStatusKind: "",
  webSearchStatusMessage: "",
  webSearchStatusKind: "",
  customContextOpen: false,
  contextPreviewOpen: false,
  diagnosticsOpen: false,
  diagnostics: [],
  refreshers: new Map(),
  pendingToolFollowUp: new Map(),
  pendingToolStatus: new Map(),
};

export function registerAgentSection() {
  if (registeredSectionID) {
    return registeredSectionID;
  }
  registeredSectionID = Zotero.ItemPaneManager.registerSection({
    paneID: "zotero-cat",
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
    onRender: ({ body, item }) => {
      renderSectionBody(body, item);
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

function isProviderConfigured(): boolean {
  const providerID = normalizeProviderID(getPref("provider"));
  if (!isApiKeyRequiredForProvider(providerID)) {
    return true;
  }
  const baseURL = normalizeString(getPref("openaiBaseUrl"), "");
  const normalizedBaseURL = normalizeBaseURL(baseURL);
  if (!normalizedBaseURL) {
    return false;
  }
  return Boolean(getProviderApiKey(providerID, normalizedBaseURL));
}

function renderProviderGate(body: HTMLDivElement, doc: Document) {
  const root = doc.createElement("div");
  root.className = "za-agent-root za-agent-gate";
  applyRootDimensions(root, body);
  ensureBodyResizeObserver(body);

  const title = doc.createElement("div");
  title.className = "za-agent-gate-title";
  title.textContent = getString("agent-gate-title");

  const message = doc.createElement("div");
  message.className = "za-agent-gate-message";
  message.textContent = getString("agent-gate-message");

  const button = doc.createElement("button");
  button.className = "za-agent-gate-button";
  button.textContent = getString("agent-gate-open-settings");
  button.addEventListener("click", () => {
    try {
      openAgentPreferences();
    } catch (error) {
      recordDiagnostic("error", formatError(error));
    }
  });

  root.append(title, message, button);
  body.replaceChildren(root);
}

function renderSectionBody(body: HTMLDivElement, item: Zotero.Item) {
  const doc = body.ownerDocument;
  if (!doc) {
    return;
  }
  if (!isProviderConfigured()) {
    renderProviderGate(body, doc);
    return;
  }
  const customContextKey = resolveCustomContextKey(item);
  const conversationScopeKey = resolveConversationScopeKey(item);
  const conversation = getActiveConversationForScope(conversationScopeKey);
  const conversationKey = conversation.key;
  const conversationMessages = conversation.messages;
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
  applyRootDimensions(root, body);
  ensureBodyResizeObserver(body);

  const messages = doc.createElement("div");
  messages.className = "za-agent-messages";
  if (!conversationMessages.length) {
    const empty = doc.createElement("div");
    empty.className = "za-agent-empty";
    empty.textContent = getString("agent-empty-state");
    messages.appendChild(empty);
  } else {
    const toolStatusText = runtime.pendingToolStatus.get(conversationKey) || "";
    for (const [index, message] of conversationMessages.entries()) {
      const bubble = doc.createElement("div");
      bubble.className = `za-agent-message za-agent-${message.role}`;
      const isStreamingCurrent = pointsToMessage(
        runtime.streamingAssistant,
        conversationKey,
        index,
      );
      const isWaitingCurrent = pointsToMessage(
        runtime.waitingAssistant,
        conversationKey,
        index,
      );
      const showToolStatus =
        Boolean(toolStatusText) && (isStreamingCurrent || isWaitingCurrent);
      if (isStreamingCurrent && !showToolStatus) {
        bubble.classList.add("za-agent-streaming");
      }
      if (showToolStatus) {
        bubble.classList.add("za-agent-waiting");
        const statusEl = doc.createElement("div");
        statusEl.className = "za-agent-message-content za-agent-tool-status";
        const base = toolStatusText.replace(/\.+$/, "");
        const animatedDots = ".".repeat(runtime.waitingStep + 1);
        statusEl.textContent = `${base}${animatedDots}`;
        bubble.append(statusEl, createMessageMeta(doc, message));
      } else if (isWaitingCurrent) {
        bubble.classList.add("za-agent-waiting");
        const waitingText = doc.createElement("div");
        waitingText.className = "za-agent-message-content";
        waitingText.textContent = `${getString("agent-waiting-label")}${".".repeat(runtime.waitingStep + 1)}`;
        bubble.append(waitingText, createMessageMeta(doc, message));
      } else {
        const content = doc.createElement("div");
        content.className = "za-agent-message-content";
        renderMessageMarkdown(content, message.content);
        bubble.append(
          content,
          createMessageMeta(doc, message),
          createCopyButton(doc, message.content),
        );
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

  const pendingBatch = getBatchForConversation(conversationKey);
  if (pendingBatch && pendingBatch.proposals.length) {
    messages.appendChild(
      renderProposalBatch(doc, pendingBatch, {
        onAccept(id) {
          setProposalStatus(conversationKey, id, "accepted");
          void maybeApplyResolvedBatch(conversationKey);
        },
        onReject(id) {
          setProposalStatus(conversationKey, id, "rejected");
          void maybeApplyResolvedBatch(conversationKey);
        },
        onAcceptAll() {
          acceptAllPending(conversationKey);
          void applyBatchAndContinue(conversationKey, false);
        },
        onRejectAll() {
          rejectAllPending(conversationKey);
          void maybeApplyResolvedBatch(conversationKey);
        },
      }),
    );
  }

  const composer = doc.createElement("div");
  composer.className = "za-agent-composer";

  const controls = doc.createElement("div");
  controls.className = "za-agent-controls";

  const providerID = normalizeProviderID(getPref("provider"));
  const baseURL = normalizeString(getPref("openaiBaseUrl"), "");
  const currentModel = normalizeString(
    getPref("openaiModel"),
    getDefaultModelForProvider(providerID),
  );
  const currentReasoningEffort = normalizeReasoningEffort(
    getPref("openaiReasoningEffort"),
  );
  const reasoningOptions = resolveReasoningOptions(
    providerID,
    baseURL,
    currentModel,
  );
  const effectiveReasoningEffort = syncReasoningEffortPref(
    reasoningOptions,
    currentReasoningEffort,
  );
  const modelOptions = resolveModelOptions(
    providerID,
    baseURL,
    currentModel,
    runtime.modelOptionsBySource,
  );

  const modelRow = doc.createElement("div");
  modelRow.className = "za-agent-model-row";

  const modelLabel = doc.createElement("span");
  modelLabel.className = "za-agent-template-label";
  modelLabel.textContent = `${getModelLabel()}:`;

  const modelSelect = doc.createElement("select");
  modelSelect.className = "za-agent-model-select";
  modelSelect.disabled = runtime.sending || runtime.modelFetchBusy;
  renderModelOptions(modelSelect, modelOptions);
  modelSelect.value = currentModel;
  modelSelect.addEventListener("change", () => {
    const nextModel = normalizeString(modelSelect.value, currentModel);
    setPref("openaiModel", nextModel);
    syncReasoningEffortPref(
      resolveReasoningOptions(providerID, baseURL, nextModel),
      normalizeReasoningEffort(getPref("openaiReasoningEffort")),
    );
    void refreshAllSections();
  });

  const fetchModelsButton = doc.createElement("button");
  fetchModelsButton.className = "za-agent-model-fetch";
  fetchModelsButton.disabled = runtime.sending || runtime.modelFetchBusy;
  fetchModelsButton.textContent = runtime.modelFetchBusy
    ? getFetchingModelsLabel()
    : getFetchModelsLabel();
  fetchModelsButton.addEventListener("click", () => {
    if (runtime.sending || runtime.modelFetchBusy) {
      return;
    }
    runtime.modelFetchBusy = true;
    runtime.modelFetchStatusMessage = "";
    runtime.modelFetchStatusKind = "";
    void refreshAllSections();
    void fetchModelsFromCurrentProvider(providerID, baseURL)
      .then((modelInfos) => {
        const models = modelInfos.map((modelInfo) => modelInfo.id);
        runtime.modelOptionsBySource.set(
          buildModelSourceKey(providerID, baseURL),
          models,
        );
        runtime.modelContextBySource.set(
          buildModelSourceKey(providerID, baseURL),
          buildModelContextMap(modelInfos),
        );
        runtime.modelReasoningBySource.set(
          buildModelSourceKey(providerID, baseURL),
          buildModelReasoningMap(modelInfos),
        );
        const nextModel = models.includes(currentModel)
          ? currentModel
          : models[0] || currentModel;
        setPref("openaiModel", nextModel);
        syncReasoningEffortPref(
          resolveReasoningOptions(providerID, baseURL, nextModel),
          normalizeReasoningEffort(getPref("openaiReasoningEffort")),
        );
        runtime.modelFetchStatusKind = "success";
        runtime.modelFetchStatusMessage = getModelsFetchedMessage(
          summarizeModelMetadataAvailability(modelInfos),
        );
      })
      .catch((error) => {
        const message = formatModelFetchError(error);
        runtime.modelFetchStatusKind = "error";
        runtime.modelFetchStatusMessage = message;
        recordDiagnostic("error", message);
      })
      .finally(() => {
        runtime.modelFetchBusy = false;
        void refreshAllSections();
      });
  });

  const reasoningLabel = doc.createElement("span");
  reasoningLabel.className = "za-agent-template-label";
  reasoningLabel.textContent = `${getReasoningLabel()}:`;

  const reasoningSelect = doc.createElement("select");
  reasoningSelect.className = "za-agent-reasoning-select";
  reasoningSelect.disabled = runtime.sending || runtime.modelFetchBusy;
  renderReasoningOptions(reasoningSelect, reasoningOptions);
  reasoningSelect.value = effectiveReasoningEffort;
  reasoningSelect.addEventListener("change", () => {
    setPref(
      "openaiReasoningEffort",
      normalizeReasoningEffort(reasoningSelect.value),
    );
    void refreshAllSections();
  });

  const reasoningStatus = doc.createElement("span");
  reasoningStatus.className = "za-agent-reasoning-status";
  reasoningStatus.textContent = getReasoningStatusText(
    providerID,
    baseURL,
    currentModel,
  );

  modelRow.append(modelLabel, modelSelect, fetchModelsButton);

  const templateRow = doc.createElement("div");
  templateRow.className = "za-agent-template-row";

  const templateLabel = doc.createElement("span");
  templateLabel.className = "za-agent-template-label";
  templateLabel.textContent = `${getString("agent-template-label")}:`;

  const templateSelect = doc.createElement("select");
  templateSelect.className = "za-agent-template-select";
  templateSelect.disabled = runtime.sending;
  for (const template of getPromptTemplates()) {
    const option = doc.createElement("option");
    option.value = template.id;
    option.textContent = template.label;
    templateSelect.appendChild(option);
  }
  templateSelect.value = getPromptTemplateByID(runtime.templateID).id;
  templateSelect.addEventListener("change", () => {
    runtime.templateID = getPromptTemplateByID(templateSelect.value).id;
    void refreshAllSections();
  });
  templateRow.append(
    templateLabel,
    templateSelect,
    reasoningLabel,
    reasoningSelect,
    reasoningStatus,
  );

  const contextRow = doc.createElement("div");
  contextRow.className = "za-agent-context-row";
  contextRow.append(
    createContextToggle(
      doc,
      "agent-context-metadata",
      runtime.contextOptions.includeMetadata,
      runtime.sending,
      (nextValue) => {
        runtime.contextOptions.includeMetadata = nextValue;
        void refreshAllSections();
      },
    ),
    createContextToggle(
      doc,
      "agent-context-notes",
      runtime.contextOptions.includeNotes,
      runtime.sending,
      (nextValue) => {
        runtime.contextOptions.includeNotes = nextValue;
        void refreshAllSections();
      },
    ),
    createContextToggle(
      doc,
      "agent-context-annotations",
      runtime.contextOptions.includeAnnotations,
      runtime.sending,
      (nextValue) => {
        runtime.contextOptions.includeAnnotations = nextValue;
        void refreshAllSections();
      },
    ),
    createContextToggle(
      doc,
      "agent-context-selected-text",
      runtime.contextOptions.includeSelectedText,
      runtime.sending,
      (nextValue) => {
        runtime.contextOptions.includeSelectedText = nextValue;
        void refreshAllSections();
      },
    ),
    createContextToggle(
      doc,
      "agent-web-search-toggle",
      isWebSearchEnabled(),
      runtime.sending,
      (nextValue) => {
        setPref("webSearchEnabled", nextValue);
        runtime.webSearchStatusMessage = "";
        runtime.webSearchStatusKind = "";
        void refreshAllSections();
      },
    ),
    createContextToggle(
      doc,
      "agent-pdf-tools-toggle",
      isPdfToolsEnabledPref(),
      runtime.sending,
      (nextValue) => {
        setPref("pdfToolsEnabled", nextValue);
        void refreshAllSections();
      },
    ),
    createContextToggle(
      doc,
      "agent-pdf-tools-auto-apply",
      isPdfToolsAutoApplyPref(),
      runtime.sending || !isPdfToolsEnabledPref(),
      (nextValue) => {
        setPref("pdfToolsAutoApply", nextValue);
        void refreshAllSections();
      },
    ),
  );
  controls.append(
    modelRow,
    templateRow,
    contextRow,
    createCustomContextInput(doc, customContextKey),
    createContextPreview(
      doc,
      item,
      {
        providerID,
        baseURL,
        model: currentModel,
      },
      customContextKey,
    ),
    createDiagnosticsPanel(doc),
  );
  if (runtime.modelFetchStatusMessage) {
    const status = doc.createElement("div");
    status.className = "za-agent-model-status";
    if (runtime.modelFetchStatusKind) {
      status.dataset.kind = runtime.modelFetchStatusKind;
    }
    status.textContent = runtime.modelFetchStatusMessage;
    controls.append(status);
  }
  if (runtime.webSearchStatusMessage) {
    const status = doc.createElement("div");
    status.className = "za-agent-model-status";
    if (runtime.webSearchStatusKind) {
      status.dataset.kind = runtime.webSearchStatusKind;
    }
    status.textContent = runtime.webSearchStatusMessage;
    controls.append(status);
  }

  const composerLocked = hasPendingBatch(conversationKey);

  const input = doc.createElement("input");
  input.className = "za-agent-input";
  input.type = "text";
  input.placeholder = composerLocked
    ? getString("agent-proposals-composer-locked")
    : getString("agent-input-placeholder");
  input.disabled = runtime.sending || composerLocked;

  const sendButton = doc.createElement("button");
  sendButton.className = "za-agent-send";
  sendButton.classList.add(runtime.sending ? "is-stop" : "is-send");
  sendButton.disabled = composerLocked && !runtime.sending;
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
    runtime.webSearchStatusMessage = "";
    runtime.webSearchStatusKind = "";
    const requestToken = runtime.requestToken;
    conversation.messages.push({
      role: "user",
      content: prompt,
      createdAt: Date.now(),
    });
    touchConversation(conversation);
    const requestMessages = toProviderMessages(conversation.messages);
    const templateID = runtime.templateID;
    const contextOptions = { ...runtime.contextOptions };
    const customContext = getCustomContextForKey(customContextKey);
    const modelContextWindow = resolveModelContextWindow(
      providerID,
      baseURL,
      currentModel,
    );
    const requestReasoningEffort = syncReasoningEffortPref(
      resolveReasoningOptions(providerID, baseURL, currentModel),
      normalizeReasoningEffort(getPref("openaiReasoningEffort")),
    );
    const assistantMessageIndex =
      conversation.messages.push({
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      }) - 1;
    touchConversation(conversation);
    saveConversationStore();
    runtime.shouldAutoScroll = true;
    runtime.streamingAssistant = null;
    startWaitingAnimation(conversationKey, assistantMessageIndex);
    input.value = "";
    void refreshAllSections();
    void sendPreparedMessage(
      {
        requestMessages,
        item,
        contextOptions,
        templateID,
        customContext,
        modelContextWindow,
        prompt,
      },
      conversationKey,
      assistantMessageIndex,
      requestToken,
      requestReasoningEffort,
    ).finally(() => {
      if (requestToken !== runtime.requestToken) {
        return;
      }
      stopWaitingAnimation();
      runtime.streamingAssistant = null;
      runtime.sending = false;
      runtime.cancelRequested = false;
      runtime.cancelActiveRequest = null;
      clearToolStatus(conversationKey);
      saveConversationStore();
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
  root.append(
    createSessionControls(doc, conversationScopeKey, conversation),
    messages,
    controls,
    composer,
  );
  body.replaceChildren(root);
  if (runtime.shouldAutoScroll || runtime.sending) {
    scrollToBottom(messages);
    return;
  }
  if (previousScrollState) {
    restoreScrollPosition(messages, previousScrollState);
  }
}

interface PreparedMessageOptions {
  requestMessages: AgentMessage[];
  item: Zotero.Item;
  contextOptions: AgentContextOptions;
  templateID: string;
  customContext: string;
  modelContextWindow: number | null;
  prompt: string;
}

async function sendPreparedMessage(
  options: PreparedMessageOptions,
  conversationKey: string,
  assistantMessageIndex: number,
  requestToken: number,
  reasoningEffort: ReasoningEffortValue,
) {
  const externalContext = await resolveWebSearchContext(
    options.prompt,
    options.item,
    requestToken,
  );
  if (requestToken !== runtime.requestToken) {
    return;
  }
  if (runtime.cancelRequested) {
    await handleChatFailure(
      new Error("Request aborted"),
      conversationKey,
      assistantMessageIndex,
    );
    return;
  }
  const requestMessages = buildRequestMessagesWithContext(
    options.requestMessages,
    {
      item: options.item,
      contextOptions: options.contextOptions,
      templateID: options.templateID,
      customContext: options.customContext,
      externalContext,
      modelContextWindow: options.modelContextWindow,
      includePdfToolsRules: isPdfToolsEnabledPref(),
    },
  );
  await sendMessage(
    requestMessages,
    conversationKey,
    assistantMessageIndex,
    requestToken,
    reasoningEffort,
  );
  if (requestToken !== runtime.requestToken || runtime.cancelRequested) {
    return;
  }
  await continueAfterAssistantToolAction(
    requestMessages,
    conversationKey,
    assistantMessageIndex,
    requestToken,
    reasoningEffort,
    options.item,
  );
}

async function sendMessage(
  requestMessages: AgentMessage[],
  conversationKey: string,
  assistantMessageIndex: number,
  requestToken: number,
  reasoningEffort: ReasoningEffortValue,
) {
  let attempt = 1;
  while (attempt <= CHAT_MAX_ATTEMPTS) {
    let receivedStreamDelta = false;
    try {
      await runChatAttempt(
        requestMessages,
        conversationKey,
        assistantMessageIndex,
        requestToken,
        reasoningEffort,
        (value) => {
          receivedStreamDelta = value;
        },
      );
      return;
    } catch (error) {
      if (requestToken !== runtime.requestToken) {
        return;
      }
      if (
        shouldRetryChatError(
          error,
          attempt,
          CHAT_MAX_ATTEMPTS,
          receivedStreamDelta,
          runtime.cancelRequested,
        )
      ) {
        recordDiagnostic(
          "warning",
          getString("agent-diagnostics-retrying", {
            args: {
              attempt: String(attempt + 1),
              max: String(CHAT_MAX_ATTEMPTS),
            },
          }),
          formatError(error),
        );
        attempt += 1;
        await refreshAllSections();
        await Zotero.Promise.delay(CHAT_RETRY_DELAY_MS);
        if (requestToken !== runtime.requestToken || runtime.cancelRequested) {
          return;
        }
        continue;
      }
      await handleChatFailure(error, conversationKey, assistantMessageIndex);
      return;
    }
  }
}

const MAX_TOOL_CHAIN_DEPTH = 3;

function getToolStatusLabel(actionType: string): string {
  const type = actionType.toLowerCase();
  if (type === "web-search") {
    return getString("agent-tool-running-web-search");
  }
  if (type === "read-pdf" || type === "list-annotations") {
    return getString("agent-tool-running-pdf");
  }
  if (
    type === "propose-annotation" ||
    type === "modify-annotation" ||
    type === "delete-annotation"
  ) {
    return getString("agent-tool-running-proposals");
  }
  return getString("agent-tool-running-generic");
}

function setToolStatus(conversationKey: string, label: string) {
  const hadStatus = runtime.pendingToolStatus.size > 0;
  runtime.pendingToolStatus.set(conversationKey, label);
  // Anchor the status pill to the current assistant message so rendering picks
  // it up even between stream phases, and kick off the animation loop if none
  // is running.
  const anchor = runtime.streamingAssistant || runtime.waitingAssistant;
  if (
    anchor?.conversationKey === conversationKey &&
    runtime.waitingAssistant === null
  ) {
    runtime.waitingAssistant = {
      conversationKey,
      messageIndex: anchor.messageIndex,
    };
    runtime.waitingStartedAt = runtime.waitingStartedAt ?? Date.now();
  }
  const hasWaiting = runtime.waitingAssistant !== null;
  if (!hadStatus && runtime.sending) {
    if (!hasWaiting) {
      // Caller did not provide an anchor; still run the loop so dots animate
      // against whatever message is the current assistant.
    }
    runtime.waitingToken += 1;
    const token = runtime.waitingToken;
    void runWaitingLoop(token);
  }
}

function clearToolStatus(conversationKey: string) {
  runtime.pendingToolStatus.delete(conversationKey);
  if (
    runtime.pendingToolStatus.size === 0 &&
    runtime.waitingAssistant === null
  ) {
    runtime.waitingStep = 0;
  }
}

async function continueAfterAssistantToolAction(
  requestMessages: AgentMessage[],
  conversationKey: string,
  assistantMessageIndex: number,
  requestToken: number,
  reasoningEffort: ReasoningEffortValue,
  item: Zotero.Item | null,
  depth: number = 0,
) {
  if (depth >= MAX_TOOL_CHAIN_DEPTH) {
    clearToolStatus(conversationKey);
    await refreshAllSections();
    return;
  }
  const assistantMessage = getConversationMessage(
    conversationKey,
    assistantMessageIndex,
  );
  if (!assistantMessage) {
    clearToolStatus(conversationKey);
    return;
  }
  const actions = parseAssistantToolActions(assistantMessage.content);
  if (!actions.length) {
    // Final natural-language response — reveal content and clear status pill.
    clearToolStatus(conversationKey);
    await refreshAllSections();
    return;
  }
  const actionContent = assistantMessage.content;
  const readActions = actions.filter((action) => action.readOnly);
  const writeActions = actions.filter((action) => !action.readOnly);
  const primaryActionType =
    readActions[0]?.type || writeActions[0]?.type || "generic";
  setToolStatus(conversationKey, getToolStatusLabel(primaryActionType));

  let readResults = "";
  if (readActions.length) {
    assistantMessage.content = stripToolActionJSON(actionContent);
    touchConversationByKey(conversationKey);
    saveConversationStore();
    await refreshAllSections();

    const resultPieces: string[] = [];
    for (const action of readActions) {
      setToolStatus(conversationKey, getToolStatusLabel(action.type));
      await refreshAllSections();
      const externalContext = await executeToolAction(action, {
        requestToken,
        item,
        onStatus: (status) =>
          applyWebSearchStatus(status as WebSearchRunStatus),
      });
      if (requestToken !== runtime.requestToken) {
        return;
      }
      resultPieces.push(
        `[tool:${action.type}]\n${externalContext || "(no output)"}`,
      );
      if (externalContext.startsWith("ERROR:")) {
        recordDiagnostic(
          "error",
          getString("agent-tool-failed", {
            args: { tool: action.type },
          }),
          externalContext,
        );
      }
    }
    readResults = resultPieces.join("\n\n");
  }

  if (requestToken !== runtime.requestToken) {
    return;
  }
  if (runtime.cancelRequested) {
    clearToolStatus(conversationKey);
    await handleChatFailure(
      new Error("Request aborted"),
      conversationKey,
      assistantMessageIndex,
    );
    return;
  }

  if (writeActions.length && item && isPdfToolsEnabledPref()) {
    setToolStatus(conversationKey, getString("agent-tool-running-proposals"));
    await refreshAllSections();
    const locale = (Zotero.locale || "en").startsWith("zh") ? "zh" : "en";
    const proposals = [] as Awaited<ReturnType<typeof resolveWriteAction>>;
    for (const action of writeActions) {
      if (!isAnnotationWriteAction(action)) {
        continue;
      }
      const resolved = await resolveWriteAction(action, { item, locale });
      proposals.push(...resolved);
    }
    if (proposals.length) {
      const batch = createBatch(
        conversationKey,
        assistantMessageIndex,
        proposals,
      );
      assistantMessage.content = getString("agent-tool-proposals-placeholder", {
        args: { count: String(batch.proposals.length) },
      });
      touchConversationByKey(conversationKey);
      saveConversationStore();
      runtime.pendingToolFollowUp.set(conversationKey, {
        requestMessages,
        assistantContent: actionContent,
        assistantMessageIndex,
        reasoningEffort,
        item,
        readResults,
      });
      // Batch UI takes over from here; clear the status pill so the batch card
      // is the primary focus.
      clearToolStatus(conversationKey);
      await refreshAllSections();
      if (isPdfToolsAutoApplyPref()) {
        await applyBatchAndContinue(batch.conversationKey, true);
      }
      return;
    }
  }

  // Write actions were parsed but couldn't be executed (PDF tools disabled, no
  // item, or no proposals produced). Strip the action JSON from the visible
  // bubble so the raw blocks don't leak, but keep the surrounding prose.
  const hasUnexecutedWrites = writeActions.length > 0;

  if (readResults) {
    assistantMessage.content = stripToolActionJSON(actionContent);
  } else if (hasUnexecutedWrites) {
    assistantMessage.content =
      stripToolActionJSON(actionContent) ||
      getString("agent-tool-proposals-placeholder", {
        args: { count: String(writeActions.length) },
      });
  } else {
    assistantMessage.content = actionContent;
  }
  touchConversationByKey(conversationKey);
  saveConversationStore();
  await refreshAllSections();

  if (!readResults) {
    // No more tool work; reveal the (cleaned) content.
    clearToolStatus(conversationKey);
    await refreshAllSections();
    return;
  }

  const primaryReadType = readActions[0]?.type || "tool";
  // Keep the status pill visible while we wait for the model's next reply.
  setToolStatus(conversationKey, getToolStatusLabel(primaryReadType));
  await refreshAllSections();

  const followUpMessages = [
    ...requestMessages,
    { role: "assistant", content: actionContent } as AgentMessage,
    {
      role: "user",
      content: buildToolActionFollowUpPrompt(
        primaryReadType,
        readResults,
        primaryReadType !== "web-search" && isPdfToolsEnabledPref(),
      ),
    } as AgentMessage,
  ];
  await sendMessage(
    followUpMessages,
    conversationKey,
    assistantMessageIndex,
    requestToken,
    reasoningEffort,
  );

  if (requestToken !== runtime.requestToken || runtime.cancelRequested) {
    return;
  }

  // Recurse to handle any new tool actions the model emits after receiving
  // the read result (e.g. propose_annotation after read_pdf).
  await continueAfterAssistantToolAction(
    followUpMessages,
    conversationKey,
    assistantMessageIndex,
    requestToken,
    reasoningEffort,
    item,
    depth + 1,
  );
}

function stripToolActionJSON(content: string): string {
  const withoutFenced = content.replace(
    /```(?:json)?\s*([\s\S]*?)```/gi,
    (match, inner) => {
      const text = typeof inner === "string" ? inner.trim() : "";
      if (!text) {
        return match;
      }
      try {
        const parsed = JSON.parse(text);
        if (isActionRecord(parsed) || isActionArray(parsed)) {
          return "";
        }
      } catch (_error) {
        // Not JSON; keep the original block.
      }
      return match;
    },
  );
  return withoutFenced.replace(/\n{3,}/g, "\n\n").trim();
}

function isActionRecord(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "action" in (value as Record<string, unknown>)
  );
}

function isActionArray(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => isActionRecord(entry));
}

async function maybeApplyResolvedBatch(conversationKey: string): Promise<void> {
  if (hasPendingBatch(conversationKey)) {
    await refreshAllSections();
    return;
  }
  await applyBatchAndContinue(conversationKey, false);
}

async function applyBatchAndContinue(
  conversationKey: string,
  autoAcceptAll: boolean,
) {
  const batch = getBatchForConversation(conversationKey);
  if (!batch) {
    return;
  }
  if (autoAcceptAll) {
    acceptAllPending(conversationKey);
  }
  const pending = runtime.pendingToolFollowUp.get(conversationKey);
  setToolStatus(conversationKey, getString("agent-tool-running-applying"));
  await refreshAllSections();
  const attachmentCache = new Map<number, Zotero.Item | null>();
  for (const proposal of batch.proposals) {
    if (proposal.status !== "accepted") {
      continue;
    }
    const attachment = resolveAttachmentFor(proposal, attachmentCache);
    if (!attachment) {
      setProposalStatus(
        conversationKey,
        proposal.id,
        "failed",
        "Attachment not found.",
      );
      continue;
    }
    const result = await applyProposal(attachment, proposal);
    if (!result.success) {
      setProposalStatus(
        conversationKey,
        proposal.id,
        "failed",
        result.error || "Apply failed.",
      );
    }
  }
  await refreshAllSections();
  if (!pending) {
    clearBatch(conversationKey);
    clearToolStatus(conversationKey);
    await refreshAllSections();
    return;
  }
  const summary = summarizeBatch(batch);
  const followUpPrompt = buildAnnotationFollowUpPrompt(batch, summary);
  const followUpMessages = [
    ...pending.requestMessages,
    { role: "assistant", content: pending.assistantContent } as AgentMessage,
    { role: "user", content: followUpPrompt } as AgentMessage,
  ];
  runtime.pendingToolFollowUp.delete(conversationKey);
  clearBatch(conversationKey);
  setToolStatus(conversationKey, getString("agent-tool-running-generic"));
  await refreshAllSections();
  runtime.sending = true;
  runtime.cancelRequested = false;
  runtime.requestToken += 1;
  const requestToken = runtime.requestToken;
  startWaitingAnimation(conversationKey, pending.assistantMessageIndex);
  try {
    await sendMessage(
      followUpMessages,
      conversationKey,
      pending.assistantMessageIndex,
      requestToken,
      pending.reasoningEffort,
    );
    if (requestToken !== runtime.requestToken || runtime.cancelRequested) {
      return;
    }
    await continueAfterAssistantToolAction(
      followUpMessages,
      conversationKey,
      pending.assistantMessageIndex,
      requestToken,
      pending.reasoningEffort,
      pending.item,
    );
  } finally {
    if (requestToken === runtime.requestToken) {
      stopWaitingAnimation();
      runtime.sending = false;
      runtime.cancelRequested = false;
      runtime.cancelActiveRequest = null;
      clearToolStatus(conversationKey);
      saveConversationStore();
      await refreshAllSections();
    }
  }
}

async function applyProposal(
  attachment: Zotero.Item,
  proposal: AnnotationProposal,
): Promise<SaveAnnotationResult> {
  if (proposal.op === "create") {
    return createAnnotation(attachment, proposal.resolved);
  }
  if (proposal.op === "update") {
    if (!proposal.annotationKey) {
      return { success: false, error: "Missing annotation key." };
    }
    return updateAnnotation(attachment, {
      ...proposal.resolved,
      key: proposal.annotationKey,
    });
  }
  if (proposal.op === "delete") {
    if (!proposal.annotationKey) {
      return { success: false, error: "Missing annotation key." };
    }
    return deleteAnnotation(attachment, proposal.annotationKey);
  }
  return { success: false, error: "Unknown proposal op." };
}

function resolveAttachmentFor(
  proposal: AnnotationProposal,
  cache: Map<number, Zotero.Item | null>,
): Zotero.Item | null {
  if (cache.has(proposal.attachmentID)) {
    return cache.get(proposal.attachmentID) || null;
  }
  const attachment =
    (Zotero.Items.get(proposal.attachmentID) as Zotero.Item | false) || null;
  cache.set(proposal.attachmentID, attachment);
  return attachment;
}

function buildAnnotationFollowUpPrompt(
  batch: AnnotationBatch,
  summary: ReturnType<typeof summarizeBatch>,
): string {
  const isZh = (Zotero.locale || "en").startsWith("zh");
  const bullets = batch.proposals
    .map((proposal) => {
      const op = proposal.op.toUpperCase();
      const status = proposal.status.toUpperCase();
      const page = proposal.resolved.pageLabel;
      const snippet = (proposal.sourceSnippet || "").slice(0, 80);
      const err = proposal.errorMessage
        ? ` [error: ${proposal.errorMessage}]`
        : "";
      return `- ${op} p.${page} [${status}] ${snippet}${err}`;
    })
    .join("\n");
  if (isZh) {
    return [
      "已处理你提议的标注批次,结果如下。请基于此继续对话(例如确认、追加下一批,或说明不再需要写操作)。",
      `汇总:accepted=${summary.accepted} rejected=${summary.rejected} failed=${summary.failed} pending=${summary.pending}`,
      bullets,
    ].join("\n\n");
  }
  return [
    "The annotation batch you proposed has been processed. Continue the conversation based on the results (e.g. confirm, propose more, or state you no longer need write actions).",
    `Summary: accepted=${summary.accepted} rejected=${summary.rejected} failed=${summary.failed} pending=${summary.pending}`,
    bullets,
  ].join("\n\n");
}

async function runChatAttempt(
  requestMessages: AgentMessage[],
  conversationKey: string,
  assistantMessageIndex: number,
  requestToken: number,
  reasoningEffort: ReasoningEffortValue,
  setReceivedStreamDelta: (value: boolean) => void,
) {
  const provider = createProviderFromPrefs();
  let receivedStreamDelta = false;
  let refreshScheduled = false;
  const queueStreamRefresh = () => {
    if (refreshScheduled) {
      return;
    }
    refreshScheduled = true;
    void Promise.resolve().then(async () => {
      refreshScheduled = false;
      await refreshAllSections();
    });
  };
  const reply = await provider.chat(requestMessages, {
    reasoningEffort,
    onCanceller(cancel) {
      if (requestToken !== runtime.requestToken) {
        return;
      }
      runtime.cancelActiveRequest = cancel;
      if (runtime.cancelRequested) {
        cancel();
      }
    },
    onStreamDelta(delta) {
      if (requestToken !== runtime.requestToken || !delta) {
        return;
      }
      const assistantMessage = getConversationMessage(
        conversationKey,
        assistantMessageIndex,
      );
      if (!assistantMessage) {
        return;
      }
      if (!receivedStreamDelta) {
        receivedStreamDelta = true;
        setReceivedStreamDelta(true);
        stopWaitingAnimation();
        runtime.streamingAssistant = {
          conversationKey,
          messageIndex: assistantMessageIndex,
        };
        assistantMessage.content = "";
      }
      assistantMessage.content += delta;
      touchConversationByKey(conversationKey);
      runtime.shouldAutoScroll = true;
      queueStreamRefresh();
    },
  });
  if (requestToken !== runtime.requestToken) {
    return;
  }
  if (receivedStreamDelta) {
    const assistantMessage = getConversationMessage(
      conversationKey,
      assistantMessageIndex,
    );
    if (assistantMessage && !assistantMessage.content.trim() && reply.trim()) {
      assistantMessage.content = reply;
      touchConversationByKey(conversationKey);
    }
    runtime.streamingAssistant = null;
    saveConversationStore();
    await refreshAllSections();
    return;
  }
  stopWaitingAnimation();
  runtime.streamingAssistant = {
    conversationKey,
    messageIndex: assistantMessageIndex,
  };
  await streamAssistantReply(conversationKey, assistantMessageIndex, reply);
  saveConversationStore();
}

async function handleChatFailure(
  error: unknown,
  conversationKey: string,
  assistantMessageIndex: number,
) {
  stopWaitingAnimation();
  const assistantMessage = getConversationMessage(
    conversationKey,
    assistantMessageIndex,
  );
  if (!assistantMessage) {
    return;
  }
  runtime.streamingAssistant = null;
  clearToolStatus(conversationKey);
  if (runtime.cancelRequested || isAbortError(error)) {
    assistantMessage.content = getString("agent-cancelled");
    touchConversationByKey(conversationKey);
    saveConversationStore();
    await refreshAllSections();
    return;
  }
  const errorText = formatError(error);
  assistantMessage.content = `[${getString("agent-error-prefix")}] ${errorText}`;
  recordDiagnostic("error", errorText);
  touchConversationByKey(conversationKey);
  saveConversationStore();
  await refreshAllSections();
}

async function resolveWebSearchContext(
  prompt: string,
  item: Zotero.Item | null,
  requestToken: number,
) {
  return buildExternalWebSearchContext({
    prompt,
    item,
    locale: Zotero.locale.startsWith("zh") ? "zh" : "en",
    isCancelled() {
      return requestToken !== runtime.requestToken || runtime.cancelRequested;
    },
    async onStatus(status) {
      applyWebSearchStatus(status);
      await refreshAllSections();
    },
  });
}

function isWebSearchEnabled() {
  return isWebSearchEnabledPref();
}

function buildToolActionFollowUpPrompt(
  toolType: string,
  toolResult: string,
  allowToolChaining: boolean = false,
) {
  const isZh = Zotero.locale.startsWith("zh");
  if (toolType === "web-search") {
    if (isZh) {
      return [
        "你刚才请求了联网搜索。插件已经执行搜索，结果如下。",
        toolResult || "搜索没有返回可用结果。",
        "请基于这些结果回答用户原始问题。不要再次输出 action JSON；如果结果不足，请明确说明局限。",
      ].join("\n\n");
    }
    return [
      "You requested web search. The plugin has executed the search. Results follow.",
      toolResult || "The search returned no usable results.",
      "Answer the user's original question based on these results. Do not output action JSON again; state limitations if results are insufficient.",
    ].join("\n\n");
  }
  const toolFailed = toolResult.trim().startsWith("ERROR:");
  if (isZh) {
    const chainingLine = allowToolChaining
      ? "请基于这些结果回答用户原始问题。如果需要,可以继续输出工具 action JSON(例如 propose_annotation),每轮回复最多一个写批次。"
      : "请基于这些结果回答用户原始问题。不要再次输出 action JSON。";
    const errorLine = toolFailed
      ? "\n\n注意:工具执行失败。请如实告知用户失败原因并建议检查(如 PDF 附件、插件设置等),不要根据摘要或元数据猜测 PDF 原文来新建标注——那样会导致 propose_annotation 找不到文本而全部失败。"
      : "";
    return [
      `你刚才请求了工具操作（${toolType}）。插件已经执行，结果如下。`,
      toolResult || "工具没有返回可用结果。",
      `${chainingLine}${errorLine}`,
    ].join("\n\n");
  }
  const chainingLine = allowToolChaining
    ? "Answer the user's original question based on these results. If needed, emit more tool action JSON (e.g. propose_annotation), at most one write batch per reply."
    : "Answer the user's original question based on these results. Do not output action JSON again.";
  const errorLine = toolFailed
    ? "\n\nNote: the tool failed. Tell the user plainly what went wrong and suggest checks (e.g. the PDF attachment, plugin settings). Do NOT invent highlight text from the abstract or metadata — propose_annotation will fail to locate it and all proposals will be marked failed."
    : "";
  return [
    `You requested a tool action (${toolType}). The plugin has executed it. Results follow.`,
    toolResult || "The tool returned no usable results.",
    `${chainingLine}${errorLine}`,
  ].join("\n\n");
}

function applyWebSearchStatus(status: WebSearchRunStatus) {
  switch (status.type) {
    case "searching":
      runtime.webSearchStatusMessage = getString("agent-web-search-searching");
      runtime.webSearchStatusKind = "";
      return;
    case "results":
      runtime.webSearchStatusMessage = getString("agent-web-search-results", {
        args: {
          count: String(status.count),
          provider: status.provider,
        },
      });
      runtime.webSearchStatusKind = "success";
      return;
    case "no-results":
      runtime.webSearchStatusMessage = getString("agent-web-search-no-results");
      runtime.webSearchStatusKind = "";
      return;
    case "failed":
      runtime.webSearchStatusMessage = getString("agent-web-search-failed");
      runtime.webSearchStatusKind = "error";
      recordDiagnostic(
        "warning",
        getString("agent-web-search-failed"),
        formatError(status.error),
      );
      return;
    default:
      return;
  }
}

function resolveModelContextWindow(
  providerID: string,
  baseURL: string,
  model: string,
) {
  const contextByModel = runtime.modelContextBySource.get(
    buildModelSourceKey(providerID, baseURL),
  );
  return contextByModel?.get(model) || null;
}

function resolveReasoningOptions(
  providerID: string,
  baseURL: string,
  model: string,
) {
  const reasoningByModel = runtime.modelReasoningBySource.get(
    buildModelSourceKey(providerID, baseURL),
  );
  const providerOptions = reasoningByModel?.get(model);
  if (!providerOptions?.length) {
    return ["default"] as ReasoningEffortValue[];
  }
  const options: ReasoningEffortValue[] = ["default"];
  for (const option of providerOptions) {
    if (option !== "default" && !options.includes(option)) {
      options.push(option);
    }
  }
  return options;
}

function syncReasoningEffortPref(
  options: ReasoningEffortValue[],
  requested: ReasoningEffortValue,
) {
  const effective = resolveEffectiveReasoningEffort(options, requested);
  if (effective !== requested) {
    setPref("openaiReasoningEffort", effective);
  }
  return effective;
}

function hasQueriedModelReasoning(providerID: string, baseURL: string) {
  return runtime.modelReasoningBySource.has(
    buildModelSourceKey(providerID, baseURL),
  );
}

function hasReasoningMetadata(
  providerID: string,
  baseURL: string,
  model: string,
) {
  return Boolean(
    runtime.modelReasoningBySource
      .get(buildModelSourceKey(providerID, baseURL))
      ?.get(model)?.length,
  );
}

function renderModelOptions(select: HTMLSelectElement, models: string[]) {
  const doc = select.ownerDocument;
  if (!doc) {
    return;
  }
  select.replaceChildren();
  for (const model of models) {
    const option = doc.createElement("option");
    option.value = model;
    option.textContent = model;
    select.appendChild(option);
  }
}

function renderReasoningOptions(
  select: HTMLSelectElement,
  values: ReasoningEffortValue[],
) {
  const doc = select.ownerDocument;
  if (!doc) {
    return;
  }
  select.replaceChildren();
  for (const value of values) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = getReasoningOptionLabel(value);
    select.appendChild(option);
  }
}

function getReasoningOptionLabel(value: ReasoningEffortValue) {
  const zh = Zotero.locale.startsWith("zh");
  switch (value) {
    case "default":
      return zh ? "默认" : "Default";
    case "none":
      return zh ? "无" : "None";
    case "minimal":
      return zh ? "最小" : "Minimal";
    case "low":
      return zh ? "低" : "Low";
    case "medium":
      return zh ? "中" : "Medium";
    case "high":
      return zh ? "高" : "High";
    case "xhigh":
      return zh ? "最高" : "XHigh";
    default:
      return value;
  }
}

function getModelLabel() {
  return Zotero.locale.startsWith("zh") ? "模型" : "Model";
}

function getFetchModelsLabel() {
  return Zotero.locale.startsWith("zh") ? "获取模型列表" : "Fetch Model List";
}

function getFetchingModelsLabel() {
  return Zotero.locale.startsWith("zh") ? "获取中..." : "Fetching...";
}

function getReasoningLabel() {
  return Zotero.locale.startsWith("zh") ? "思考强度" : "Reasoning";
}

function getReasoningStatusText(
  providerID: string,
  baseURL: string,
  model: string,
) {
  if (hasReasoningMetadata(providerID, baseURL, model)) {
    return Zotero.locale.startsWith("zh")
      ? "由提供方声明"
      : "Provider declared";
  }
  if (hasQueriedModelReasoning(providerID, baseURL)) {
    return Zotero.locale.startsWith("zh") ? "提供方未声明" : "Not declared";
  }
  return Zotero.locale.startsWith("zh") ? "未查询" : "Not queried";
}

function getModelsFetchedMessage(
  availability: ReturnType<typeof summarizeModelMetadataAvailability>,
) {
  const { modelCount, contextWindowCount, reasoningEffortCount } = availability;
  return Zotero.locale.startsWith("zh")
    ? `已从站点获取 ${modelCount} 个模型；${contextWindowCount} 个声明模型上下文，${reasoningEffortCount} 个声明思考强度。`
    : `Fetched ${modelCount} models from site; ${contextWindowCount} declared context windows and ${reasoningEffortCount} declared reasoning options.`;
}

function getNoModelListMessage() {
  return Zotero.locale.startsWith("zh")
    ? "站点返回结果里没有模型列表字段。"
    : "Site response does not contain a model-list field.";
}

function getEmptyModelListMessage() {
  return Zotero.locale.startsWith("zh")
    ? "站点返回了空模型列表。"
    : "Site returned an empty model list.";
}

function getModelParseMessages() {
  return {
    emptyModelList: getEmptyModelListMessage(),
    invalidJSON: Zotero.locale.startsWith("zh")
      ? "站点返回 JSON 解析失败。"
      : "Failed to parse JSON from site.",
    noModelList: getNoModelListMessage(),
    nonJSON: Zotero.locale.startsWith("zh")
      ? "站点返回的不是 JSON。"
      : "Site did not return JSON.",
  };
}

function formatModelFetchError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  const normalized = text.trim();
  return (
    normalized ||
    (Zotero.locale.startsWith("zh") ? "获取失败。" : "Fetch failed.")
  );
}

async function fetchModelsFromCurrentProvider(
  providerID: string,
  baseURL: string,
) {
  const normalizedBaseURL = normalizeBaseURL(baseURL);
  if (!normalizedBaseURL) {
    throw new Error(
      Zotero.locale.startsWith("zh")
        ? "请先在设置中填写 Base URL。"
        : "Please set Base URL first in settings.",
    );
  }
  const apiKey = normalizeAuthKey(
    getProviderApiKey(providerID, normalizedBaseURL),
  );
  if (isApiKeyRequiredForProvider(providerID) && !apiKey) {
    throw new Error(
      Zotero.locale.startsWith("zh")
        ? "当前 Provider 需要 API Key。"
        : "This provider requires an API key.",
    );
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const candidates = buildModelEndpointCandidates(normalizedBaseURL);
  let lastError: Error | null = null;
  for (const [index, endpoint] of candidates.entries()) {
    try {
      const request = await Zotero.HTTP.request("GET", endpoint, {
        headers,
        timeout: MODEL_FETCH_TIMEOUT_MS,
      });
      const modelInfos = parseModelInfos(
        request.responseText || "",
        getModelParseMessages(),
      );
      if (modelInfos.length) {
        return modelInfos;
      }
      throw new Error(
        Zotero.locale.startsWith("zh")
          ? "站点返回了空模型列表。"
          : "Site returned an empty model list.",
      );
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      if (canRetryModelEndpoint(index, candidates.length, normalizedError)) {
        lastError = normalizedError;
        continue;
      }
      throw normalizedError;
    }
  }
  throw lastError || new Error(formatModelFetchError(""));
}

function normalizeAuthKey(rawKey: string) {
  let value = rawKey.trim();
  if (!value) {
    return "";
  }
  value = value.replace(/^['"]|['"]$/g, "").trim();
  value = value.replace(/^bearer\s+/i, "").trim();
  return value;
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

export async function refreshAgentSections() {
  await refreshAllSections();
}

async function streamAssistantReply(
  conversationKey: string,
  assistantMessageIndex: number,
  fullReply: string,
) {
  const message = getConversationMessage(
    conversationKey,
    assistantMessageIndex,
  );
  if (!message) {
    return;
  }
  const chunks = [...fullReply];
  let cursor = 0;
  while (cursor < chunks.length) {
    cursor = Math.min(cursor + TYPEWRITER_STEP_CHARS, chunks.length);
    const current = getConversationMessage(
      conversationKey,
      assistantMessageIndex,
    );
    if (!current) {
      return;
    }
    current.content = chunks.slice(0, cursor).join("");
    touchConversationByKey(conversationKey);
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
    doc.defaultView ? Math.floor(doc.defaultView.innerHeight) : 0,
  );
  return Math.max(220, Math.floor(baseHeight * ROOT_HEIGHT_RATIO));
}

function firstPositive(...values: Array<number | undefined>) {
  for (const value of values) {
    if (typeof value === "number" && value > 0) {
      return value;
    }
  }
  return 480;
}

function computeAvailableWidth(body: HTMLDivElement) {
  const doc = body.ownerDocument;
  if (!doc) {
    return 300;
  }
  const paneContent = doc.getElementById(
    "zotero-item-pane-content",
  ) as HTMLElement | null;
  return firstPositive(
    body.clientWidth,
    body.parentElement?.clientWidth,
    paneContent?.clientWidth,
  );
}

function applyRootDimensions(root: HTMLDivElement, body: HTMLDivElement) {
  const fixedHeight = computeFixedRootHeight(body);
  const availableWidth = computeAvailableWidth(body);
  root.style.height = `${fixedHeight}px`;
  root.style.minHeight = `${fixedHeight}px`;
  root.style.maxHeight = `${fixedHeight}px`;
  root.style.width = "100%";
  root.style.maxWidth = `${availableWidth}px`;
  root.style.overflow = "hidden";
}

function ensureBodyResizeObserver(body: HTMLDivElement) {
  if (resizeObservers.has(body)) {
    return;
  }
  const win = body.ownerDocument?.defaultView;
  if (!win) {
    return;
  }
  const ObserverCtor = (win as unknown as Record<string, unknown>)
    .ResizeObserver as
    | (new (callback: ResizeObserverCallback) => ResizeObserver)
    | undefined;
  if (!ObserverCtor) {
    return;
  }
  const observer = new ObserverCtor(() => {
    const root = body.querySelector<HTMLDivElement>(".za-agent-root");
    if (root) {
      applyRootDimensions(root, body);
    }
  });
  observer.observe(body);
  resizeObservers.set(body, observer);
}

const CUSTOM_CONTEXT_STORE_PREF = "customContextStore";

function getCustomContextForKey(customContextKey: string) {
  ensureCustomContextStoreLoaded();
  return runtime.customContextByItemKey.get(customContextKey) || "";
}

function setCustomContextForKey(customContextKey: string, value: string) {
  if (value.trim()) {
    runtime.customContextByItemKey.set(customContextKey, value);
  } else {
    runtime.customContextByItemKey.delete(customContextKey);
  }
  saveCustomContextStore();
}

let customContextStoreLoaded = false;

function ensureCustomContextStoreLoaded() {
  if (customContextStoreLoaded) {
    return;
  }
  customContextStoreLoaded = true;
  try {
    const raw = getPref(CUSTOM_CONTEXT_STORE_PREF);
    if (typeof raw !== "string" || !raw.trim()) {
      return;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") {
      return;
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (
        typeof key === "string" &&
        typeof value === "string" &&
        value.trim()
      ) {
        runtime.customContextByItemKey.set(key, value);
      }
    }
  } catch (_error) {
    // Ignore corrupted pref
  }
}

function saveCustomContextStore() {
  const store: Record<string, string> = {};
  for (const [key, value] of runtime.customContextByItemKey) {
    if (value.trim()) {
      store[key] = value;
    }
  }
  setPref(CUSTOM_CONTEXT_STORE_PREF, JSON.stringify(store));
}

function getActiveConversationForScope(scopeKey: string) {
  ensureConversationStoreLoaded();
  const activeKey = runtime.activeConversationKeyByScope.get(scopeKey);
  const activeConversation = activeKey
    ? runtime.conversationsByKey.get(activeKey)
    : null;
  if (activeConversation?.scopeKey === scopeKey) {
    return activeConversation;
  }
  const latestConversation = getConversationsForScope(scopeKey)[0];
  if (latestConversation) {
    runtime.activeConversationKeyByScope.set(scopeKey, latestConversation.key);
    return latestConversation;
  }
  return createNewConversationForScope(scopeKey);
}

function getConversationForKey(conversationKey: string) {
  ensureConversationStoreLoaded();
  return runtime.conversationsByKey.get(conversationKey) || null;
}

function getConversationsForScope(scopeKey: string) {
  ensureConversationStoreLoaded();
  return [...runtime.conversationsByKey.values()]
    .filter((conversation) => conversation.scopeKey === scopeKey)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function createNewConversationForScope(scopeKey: string) {
  const conversation = createConversation(scopeKey);
  runtime.conversationsByKey.set(conversation.key, conversation);
  runtime.activeConversationKeyByScope.set(scopeKey, conversation.key);
  return conversation;
}

function getConversationMessage(conversationKey: string, messageIndex: number) {
  return getConversationForKey(conversationKey)?.messages[messageIndex] || null;
}

function touchConversationByKey(conversationKey: string) {
  const conversation = getConversationForKey(conversationKey);
  if (conversation) {
    touchConversation(conversation);
  }
}

function startNewConversation(scopeKey: string) {
  createNewConversationForScope(scopeKey);
  saveConversationStore();
}

function clearConversationMessages(conversationKey: string) {
  const conversation = getConversationForKey(conversationKey);
  if (!conversation) {
    return;
  }
  conversation.messages = [];
  clearToolStatus(conversationKey);
  touchConversation(conversation);
  saveConversationStore();
}

function selectConversation(scopeKey: string, conversationKey: string) {
  const conversation = getConversationForKey(conversationKey);
  if (!conversation || conversation.scopeKey !== scopeKey) {
    return;
  }
  runtime.activeConversationKeyByScope.set(scopeKey, conversation.key);
  saveConversationStore();
}

function deleteConversation(scopeKey: string, conversationKey: string) {
  const conversation = getConversationForKey(conversationKey);
  if (!conversation || conversation.scopeKey !== scopeKey) {
    return;
  }
  runtime.conversationsByKey.delete(conversationKey);
  clearToolStatus(conversationKey);
  const nextConversation =
    getConversationsForScope(scopeKey).find(
      (candidate) => candidate.key !== conversationKey,
    ) || createNewConversationForScope(scopeKey);
  runtime.activeConversationKeyByScope.set(scopeKey, nextConversation.key);
  saveConversationStore();
}

function pointsToMessage(
  pointer: MessagePointer | null,
  conversationKey: string,
  messageIndex: number,
) {
  return (
    pointer?.conversationKey === conversationKey &&
    pointer.messageIndex === messageIndex
  );
}

function ensureConversationStoreLoaded() {
  if (runtime.conversationStoreLoaded) {
    return;
  }
  runtime.conversationStoreLoaded = true;
  const raw = getPref("agentConversationStore");
  const store = parseConversationStorePayload(raw);
  for (const conversation of store.conversations) {
    runtime.conversationsByKey.set(conversation.key, conversation);
  }
  for (const [scopeKey, conversationKey] of Object.entries(store.active)) {
    const conversation = runtime.conversationsByKey.get(conversationKey);
    if (conversation?.scopeKey === scopeKey) {
      runtime.activeConversationKeyByScope.set(scopeKey, conversationKey);
    }
  }
  const scopes = new Set(
    store.conversations.map((conversation) => conversation.scopeKey),
  );
  for (const scopeKey of scopes) {
    if (runtime.activeConversationKeyByScope.has(scopeKey)) {
      continue;
    }
    const latest = getConversationsForScope(scopeKey)[0];
    if (latest) {
      runtime.activeConversationKeyByScope.set(scopeKey, latest.key);
    }
  }
}

function saveConversationStore() {
  ensureConversationStoreLoaded();
  const conversations = selectConversationsForPersistence(
    [...runtime.conversationsByKey.values()].filter(
      (conversation) => conversation.messages.length > 0,
    ),
  ).map(serializeConversation);
  const active = buildActiveConversationStore(
    runtime.activeConversationKeyByScope,
    runtime.conversationsByKey,
  );
  const payload = {
    version: CONVERSATION_STORE_VERSION,
    active,
    conversations,
  };
  setPref("agentConversationStore", JSON.stringify(payload));
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

function startWaitingAnimation(
  conversationKey: string,
  assistantMessageIndex: number,
) {
  runtime.waitingAssistant = {
    conversationKey,
    messageIndex: assistantMessageIndex,
  };
  runtime.waitingStartedAt = Date.now();
  runtime.waitingStep = 0;
  runtime.waitingToken += 1;
  const token = runtime.waitingToken;
  void runWaitingLoop(token);
}

function stopWaitingAnimation() {
  const waiting = runtime.waitingAssistant;
  if (waiting && runtime.waitingStartedAt !== null) {
    const assistantMessage = getConversationMessage(
      waiting.conversationKey,
      waiting.messageIndex,
    );
    if (assistantMessage && assistantMessage.responseWaitMs === undefined) {
      assistantMessage.responseWaitMs = Math.max(
        0,
        Date.now() - runtime.waitingStartedAt,
      );
      touchConversationByKey(waiting.conversationKey);
    }
  }
  runtime.waitingAssistant = null;
  runtime.waitingStartedAt = null;
  runtime.waitingStep = 0;
  runtime.waitingToken += 1;
  // If a tool-status pill is still showing, restart the animation loop so the
  // dots keep ticking. Otherwise the loop has been invalidated above.
  if (runtime.pendingToolStatus.size > 0 && runtime.sending) {
    const token = runtime.waitingToken;
    void runWaitingLoop(token);
  }
}

async function runWaitingLoop(token: number) {
  while (runtime.waitingToken === token && runtime.sending) {
    const hasWaiting = runtime.waitingAssistant !== null;
    const hasToolStatus = runtime.pendingToolStatus.size > 0;
    if (!hasWaiting && !hasToolStatus) {
      break;
    }
    runtime.waitingStep = (runtime.waitingStep + 1) % 3;
    await refreshAllSections();
    await Zotero.Promise.delay(320);
  }
}

function toProviderMessages(messages: RuntimeMessage[]): AgentMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function createMessageMeta(doc: Document, message: RuntimeMessage) {
  const meta = doc.createElement("div");
  meta.className = "za-agent-message-meta";
  const parts = [formatMessageDateTime(message.createdAt)];
  if (
    message.role === "assistant" &&
    typeof message.responseWaitMs === "number" &&
    Number.isFinite(message.responseWaitMs)
  ) {
    parts.push(
      getString("agent-meta-response-wait", {
        args: {
          seconds: formatWaitSeconds(message.responseWaitMs),
        },
      }),
    );
  }
  meta.textContent = parts.join(" · ");
  return meta;
}

function formatMessageDateTime(timestamp: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(timestamp));
  } catch (_error) {
    return new Date(timestamp).toISOString().replace("T", " ").slice(0, 19);
  }
}

function formatWaitSeconds(durationMs: number) {
  const seconds = Math.max(0, durationMs) / 1000;
  return seconds >= 10 ? seconds.toFixed(0) : seconds.toFixed(1);
}

function formatTokenCount(count: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 0,
    }).format(count);
  } catch (_error) {
    return String(Math.round(count));
  }
}

function recordDiagnostic(
  level: DiagnosticEntry["level"],
  message: string,
  detail?: string,
) {
  runtime.diagnostics.push({
    id: createRuntimeID("diag"),
    level,
    createdAt: Date.now(),
    message,
    detail,
  });
  if (runtime.diagnostics.length > MAX_DIAGNOSTIC_ENTRIES) {
    runtime.diagnostics = runtime.diagnostics.slice(-MAX_DIAGNOSTIC_ENTRIES);
  }
}

function createSessionControls(
  doc: Document,
  scopeKey: string,
  conversation: ConversationState,
) {
  const row = doc.createElement("div");
  row.className = "za-agent-session-row";
  const allConversations = getConversationsForScope(scopeKey);
  const conversations = limitConversationOptions(
    allConversations,
    conversation.key,
  );

  const label = doc.createElement("span");
  label.className = "za-agent-session-label";
  label.textContent = getString("agent-session-label", {
    args: {
      count: String(conversation.messages.length),
    },
  });

  const select = doc.createElement("select");
  select.className = "za-agent-session-select";
  select.disabled = runtime.sending;
  select.title = formatConversationOptionLabel(conversation);
  for (const candidate of conversations) {
    const option = doc.createElement("option");
    option.value = candidate.key;
    const optionLabel = formatConversationOptionLabel(candidate);
    option.textContent = optionLabel;
    option.title = optionLabel;
    select.appendChild(option);
  }
  select.value = conversation.key;
  select.addEventListener("change", () => {
    if (runtime.sending) {
      return;
    }
    selectConversation(scopeKey, select.value);
    runtime.shouldAutoScroll = true;
    void refreshAllSections();
  });

  const actions = doc.createElement("div");
  actions.className = "za-agent-session-actions";

  const newButton = doc.createElement("button");
  newButton.className = "za-agent-secondary-button";
  newButton.type = "button";
  newButton.disabled = runtime.sending;
  newButton.textContent = getString("agent-new-session");
  newButton.addEventListener("click", () => {
    if (runtime.sending) {
      return;
    }
    startNewConversation(scopeKey);
    runtime.shouldAutoScroll = true;
    void refreshAllSections();
  });

  const clearButton = doc.createElement("button");
  clearButton.className = "za-agent-secondary-button";
  clearButton.type = "button";
  clearButton.disabled = runtime.sending || !conversation.messages.length;
  clearButton.textContent = getString("agent-clear-session");
  clearButton.addEventListener("click", () => {
    if (runtime.sending) {
      return;
    }
    clearConversationMessages(conversation.key);
    runtime.shouldAutoScroll = true;
    void refreshAllSections();
  });

  const deleteButton = doc.createElement("button");
  deleteButton.className = "za-agent-secondary-button";
  deleteButton.type = "button";
  deleteButton.disabled =
    runtime.sending ||
    (!conversation.messages.length && allConversations.length <= 1);
  deleteButton.textContent = getString("agent-delete-session");
  deleteButton.addEventListener("click", () => {
    if (runtime.sending) {
      return;
    }
    deleteConversation(scopeKey, conversation.key);
    runtime.shouldAutoScroll = true;
    void refreshAllSections();
  });

  const exportButton = doc.createElement("button");
  exportButton.className = "za-agent-secondary-button";
  exportButton.type = "button";
  exportButton.disabled = !conversation.messages.length;
  exportButton.textContent = getString("agent-export-session");
  exportButton.addEventListener("click", () => {
    if (!conversation.messages.length) {
      return;
    }
    exportConversationToClipboard(conversation);
  });

  const renameButton = doc.createElement("button");
  renameButton.className = "za-agent-secondary-button";
  renameButton.type = "button";
  renameButton.disabled = runtime.sending;
  renameButton.textContent = getString("agent-rename-session");
  renameButton.addEventListener("click", () => {
    if (runtime.sending) {
      return;
    }
    renameConversation(doc, conversation);
    void refreshAllSections();
  });

  const favoriteButton = doc.createElement("button");
  favoriteButton.className = "za-agent-secondary-button";
  favoriteButton.type = "button";
  favoriteButton.disabled = runtime.sending;
  favoriteButton.textContent = conversation.favorite
    ? `★ ${getString("agent-favorite-session")}`
    : `☆ ${getString("agent-favorite-session")}`;
  favoriteButton.addEventListener("click", () => {
    if (runtime.sending) {
      return;
    }
    conversation.favorite = !conversation.favorite;
    touchConversation(conversation);
    saveConversationStore();
    void refreshAllSections();
  });

  actions.append(
    newButton,
    clearButton,
    deleteButton,
    exportButton,
    renameButton,
    favoriteButton,
  );
  row.append(label, select, actions);
  return row;
}

function limitConversationOptions(
  conversations: ConversationState[],
  activeConversationKey: string,
) {
  if (conversations.length <= MAX_VISIBLE_CONVERSATION_OPTIONS) {
    return conversations;
  }
  const visibleConversations = conversations.slice(
    0,
    MAX_VISIBLE_CONVERSATION_OPTIONS,
  );
  if (
    visibleConversations.some(
      (conversation) => conversation.key === activeConversationKey,
    )
  ) {
    return visibleConversations;
  }
  const activeConversation = conversations.find(
    (conversation) => conversation.key === activeConversationKey,
  );
  if (!activeConversation) {
    return visibleConversations;
  }
  return [
    activeConversation,
    ...visibleConversations.slice(0, MAX_VISIBLE_CONVERSATION_OPTIONS - 1),
  ];
}

function formatConversationOptionLabel(conversation: ConversationState) {
  const prefix = conversation.favorite ? "★ " : "";
  if (conversation.title) {
    return `${prefix}${truncateInline(conversation.title, 36)} · ${formatShortDateTime(conversation.updatedAt)}`;
  }
  const firstUserMessage = conversation.messages.find(
    (message) => message.role === "user" && message.content.trim(),
  );
  const summary = firstUserMessage
    ? truncateInline(firstUserMessage.content, 36)
    : getString("agent-session-untitled");
  return `${prefix}${summary} · ${formatShortDateTime(conversation.updatedAt)}`;
}

function exportConversationToClipboard(conversation: ConversationState) {
  const lines: string[] = [];
  lines.push(`# Zotero-Cat Conversation Export`);
  lines.push("");
  if (conversation.title) {
    lines.push(`**Title:** ${conversation.title}`);
  }
  lines.push(`**Date:** ${new Date(conversation.createdAt).toISOString()}`);
  lines.push(`**Messages:** ${conversation.messages.length}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  for (const message of conversation.messages) {
    const role = message.role === "user" ? "User" : "Assistant";
    const time = new Date(message.createdAt).toISOString();
    lines.push(`### ${role} (${time})`);
    lines.push("");
    lines.push(message.content);
    lines.push("");
  }
  const text = lines.join("\n");
  try {
    const win = Zotero.getMainWindow();
    if (win?.navigator?.clipboard) {
      void win.navigator.clipboard.writeText(text);
    }
  } catch (_error) {
    // Ignore clipboard errors
  }
  showToast(getString("agent-export-copied"));
}

function renameConversation(doc: Document, conversation: ConversationState) {
  const currentTitle = conversation.title || "";
  const newTitle = doc.defaultView?.prompt(
    getString("agent-rename-prompt"),
    currentTitle,
  );
  if (newTitle === null || newTitle === undefined) {
    return;
  }
  conversation.title = newTitle.trim() || undefined;
  touchConversation(conversation);
  saveConversationStore();
}

function showToast(message: string) {
  try {
    const win = Zotero.getMainWindow();
    if (!win) {
      return;
    }
    const indicator = win.document?.getElementById("zotero-catsync-indicator");
    if (indicator) {
      // Use Zotero's built-in status message if available
    }
    // Simple fallback: log to console
    Zotero.log(`[Zotero-Cat] ${message}`);
  } catch (_error) {
    // Ignore
  }
}

function createContextToggle(
  doc: Document,
  labelKey:
    | "agent-context-metadata"
    | "agent-context-notes"
    | "agent-context-annotations"
    | "agent-context-selected-text"
    | "agent-web-search-toggle"
    | "agent-pdf-tools-toggle"
    | "agent-pdf-tools-auto-apply",
  checked: boolean,
  disabled: boolean,
  onChange: (value: boolean) => void,
) {
  const label = doc.createElement("label");
  label.className = "za-agent-context-toggle";
  const checkbox = doc.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  checkbox.disabled = disabled;
  checkbox.addEventListener("change", () => {
    onChange(checkbox.checked);
  });
  const text = doc.createElement("span");
  text.textContent = getString(labelKey);
  label.append(checkbox, text);
  return label;
}

function createDiagnosticsPanel(doc: Document) {
  const details = doc.createElement("details");
  details.className = "za-agent-diagnostics";
  details.open = runtime.diagnosticsOpen;
  details.addEventListener("toggle", () => {
    runtime.diagnosticsOpen = details.open;
  });

  const summary = doc.createElement("summary");
  summary.className = "za-agent-diagnostics-summary";

  const title = doc.createElement("span");
  title.className = "za-agent-diagnostics-title";
  title.textContent = getString("agent-diagnostics-title");

  const count = doc.createElement("span");
  count.className = "za-agent-diagnostics-count";
  count.textContent = String(runtime.diagnostics.length);
  summary.append(title, count);

  const body = doc.createElement("div");
  body.className = "za-agent-diagnostics-body";
  if (!runtime.diagnostics.length) {
    const empty = doc.createElement("div");
    empty.className = "za-agent-diagnostics-empty";
    empty.textContent = getString("agent-diagnostics-empty");
    body.appendChild(empty);
  } else {
    const clearButton = doc.createElement("button");
    clearButton.className = "za-agent-secondary-button";
    clearButton.type = "button";
    clearButton.textContent = getString("agent-diagnostics-clear");
    clearButton.addEventListener("click", () => {
      runtime.diagnostics = [];
      void refreshAllSections();
    });
    body.appendChild(clearButton);
    for (const entry of runtime.diagnostics.slice().reverse()) {
      const item = doc.createElement("div");
      item.className = "za-agent-diagnostic-entry";
      item.dataset.level = entry.level;

      const meta = doc.createElement("div");
      meta.className = "za-agent-diagnostic-meta";
      meta.textContent = `${formatMessageDateTime(entry.createdAt)} · ${entry.level}`;

      const message = doc.createElement("div");
      message.className = "za-agent-diagnostic-message";
      message.textContent = entry.message;
      item.append(meta, message);

      if (entry.detail) {
        const detail = doc.createElement("pre");
        detail.className = "za-agent-diagnostic-detail";
        detail.textContent = entry.detail;
        item.appendChild(detail);
      }
      body.appendChild(item);
    }
  }

  details.append(summary, body);
  return details;
}

function createCustomContextInput(doc: Document, customContextKey: string) {
  const container = doc.createElement("details");
  container.className = "za-agent-custom-context";
  container.open = runtime.customContextOpen;
  container.addEventListener("toggle", () => {
    runtime.customContextOpen = container.open;
  });

  const summary = doc.createElement("summary");
  summary.className = "za-agent-custom-context-summary";

  const label = doc.createElement("span");
  label.className = "za-agent-custom-context-title";
  label.textContent = getString("agent-custom-context-label");

  const currentContext = getCustomContextForKey(customContextKey);
  summary.appendChild(label);
  if (currentContext.trim()) {
    const status = doc.createElement("span");
    status.className = "za-agent-custom-context-status";
    status.textContent = getString("agent-custom-context-filled");
    summary.appendChild(status);
  }

  const textarea = doc.createElement("textarea");
  textarea.className = "za-agent-custom-context-input";
  textarea.placeholder = getString("agent-custom-context-placeholder");
  textarea.value = currentContext;
  textarea.disabled = runtime.sending;
  textarea.rows = 3;
  textarea.addEventListener("input", () => {
    setCustomContextForKey(customContextKey, textarea.value);
  });
  textarea.addEventListener("change", () => {
    setCustomContextForKey(customContextKey, textarea.value);
    void refreshAllSections();
  });
  textarea.addEventListener("blur", () => {
    setCustomContextForKey(customContextKey, textarea.value);
    void refreshAllSections();
  });

  container.append(summary, textarea);
  return container;
}

function createContextPreview(
  doc: Document,
  item: Zotero.Item | null,
  modelRef: { providerID: string; baseURL: string; model: string },
  customContextKey: string,
) {
  const modelContextWindow = resolveModelContextWindow(
    modelRef.providerID,
    modelRef.baseURL,
    modelRef.model,
  );
  const preview = buildContextPreview({
    item,
    contextOptions: runtime.contextOptions,
    templateID: runtime.templateID,
    customContext: getCustomContextForKey(customContextKey),
    modelContextWindow,
  });
  const details = doc.createElement("details");
  details.className = "za-agent-context-preview";
  details.open = runtime.contextPreviewOpen;
  details.addEventListener("toggle", () => {
    runtime.contextPreviewOpen = details.open;
  });

  const summary = doc.createElement("summary");
  summary.className = "za-agent-context-preview-summary";

  const title = doc.createElement("span");
  title.className = "za-agent-context-preview-title";
  title.textContent = getString("agent-context-preview-title");

  const budgets = doc.createElement("span");
  budgets.className = "za-agent-context-budgets";

  const injectionBudget = doc.createElement("span");
  injectionBudget.className = "za-agent-context-budget";
  injectionBudget.textContent = getString("agent-context-preview-budget", {
    args: {
      used: formatTokenCount(preview.estimatedTokens),
      budget: formatTokenCount(preview.tokenBudget),
    },
  });
  if (preview.truncated || preview.estimatedTokens > preview.tokenBudget) {
    injectionBudget.dataset.kind = "warning";
  }

  const modelLimit = doc.createElement("span");
  modelLimit.className = "za-agent-context-budget";
  modelLimit.textContent = getString("agent-context-preview-model-limit", {
    args: {
      limit: modelContextWindow
        ? `${formatTokenCount(modelContextWindow)} tokens`
        : getString("agent-context-preview-model-limit-unknown"),
    },
  });
  if (!modelContextWindow) {
    modelLimit.dataset.kind = "muted";
  }
  budgets.append(injectionBudget, modelLimit);
  summary.append(title, budgets);

  const body = doc.createElement("div");
  body.className = "za-agent-context-preview-body";
  const readonlyNote = doc.createElement("div");
  readonlyNote.className = "za-agent-context-preview-note";
  readonlyNote.textContent = getString("agent-context-preview-readonly");
  body.appendChild(readonlyNote);
  if (!preview.hasZoteroContext) {
    const empty = doc.createElement("div");
    empty.className = "za-agent-context-preview-note";
    empty.textContent = getString("agent-context-preview-system-only");
    body.appendChild(empty);
  }
  if (preview.truncated) {
    const warning = doc.createElement("div");
    warning.className = "za-agent-context-preview-note";
    warning.dataset.kind = "warning";
    warning.textContent = getString("agent-context-preview-truncated");
    body.appendChild(warning);
  }

  const text = doc.createElement("pre");
  text.className = "za-agent-context-preview-text";
  text.textContent = preview.text || getString("agent-context-preview-empty");
  body.appendChild(text);
  details.append(summary, body);
  return details;
}

function createCopyButton(doc: Document, messageContent: string) {
  const button = doc.createElement("button");
  button.className = "za-agent-copy";
  const defaultLabel = getString("agent-copy-tooltip");
  button.title = defaultLabel;
  button.setAttribute("aria-label", defaultLabel);
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const copied = await copyMessageText(messageContent);
    if (!copied) {
      return;
    }
    showCopyFeedback(doc, getString("agent-copied-feedback"));
    button.classList.add("is-copied");
    const copiedLabel = getString("agent-copied-tooltip");
    button.title = copiedLabel;
    button.setAttribute("aria-label", copiedLabel);
    const view = doc.defaultView;
    view?.setTimeout(() => {
      button.classList.remove("is-copied");
      button.title = defaultLabel;
      button.setAttribute("aria-label", defaultLabel);
    }, 900);
  });
  return button;
}

async function copyMessageText(text: string) {
  const value = text.trim();
  if (!value) {
    return false;
  }
  try {
    Zotero.Utilities.Internal.copyTextToClipboard(value);
    return true;
  } catch (_error) {
    try {
      if (!globalThis.navigator?.clipboard?.writeText) {
        return false;
      }
      await globalThis.navigator.clipboard.writeText(value);
      return true;
    } catch (_fallbackError) {
      return false;
    }
  }
}

function showCopyFeedback(doc: Document, message: string) {
  const root = doc.querySelector<HTMLElement>(".za-agent-root");
  if (!root) {
    return;
  }
  const previous = root.querySelector(".za-agent-copy-toast");
  if (previous) {
    previous.remove();
  }
  const toast = doc.createElement("div");
  toast.className = "za-agent-copy-toast";
  toast.textContent = message;
  root.appendChild(toast);
  const view = doc.defaultView;
  if (!view) {
    return;
  }
  view.requestAnimationFrame(() => {
    toast.classList.add("is-visible");
  });
  view.setTimeout(() => {
    toast.classList.remove("is-visible");
    view.setTimeout(() => {
      toast.remove();
    }, 160);
  }, 950);
}
