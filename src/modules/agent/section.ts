import { getLocaleID, getString } from "../../utils/locale";
import { getPref, setPref } from "../../utils/prefs";
import {
  AgentContextOptions,
  buildContextPreview,
  buildRequestMessagesWithContext,
  getDefaultContextOptions,
} from "./context";
import {
  AgentMessage,
  createProviderFromPrefs,
  isApiKeyRequiredForProvider,
} from "./provider";
import {
  DEFAULT_PROMPT_TEMPLATE_ID,
  getPromptTemplateByID,
  getPromptTemplates,
} from "./promptTemplates";
import { getProviderApiKey } from "./secureApiKey";

let registeredSectionID: string | false = false;
const TYPEWRITER_STEP_CHARS = 3;
const TYPEWRITER_DELAY_MS = 18;
const SCROLL_BOTTOM_THRESHOLD_PX = 24;
const MODEL_FETCH_TIMEOUT_MS = 25_000;
const ROOT_HEIGHT_RATIO = 0.9;
const INLINE_MARKDOWN_PATTERN =
  /\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
const MARKDOWN_BLOCK_START_PATTERN = /^(#{1,6}\s+|```|>\s?|[-*+]\s+|\d+\.\s+)/;

const REASONING_EFFORT_VALUES = [
  "default",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;
type ReasoningEffortValue = (typeof REASONING_EFFORT_VALUES)[number];
const FALLBACK_MODEL_ID = "gpt-4o-mini";

type ModelProbeErrorCode =
  | "non_json"
  | "invalid_json"
  | "empty_model_list"
  | "no_model_list";

class ModelProbeError extends Error {
  constructor(
    readonly code: ModelProbeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ModelProbeError";
  }
}

interface ScrollState {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

interface RuntimeMessage extends AgentMessage {
  createdAt: number;
  responseWaitMs?: number;
}

interface ModelInfo {
  id: string;
  contextWindow: number | null;
  reasoningEfforts: ReasoningEffortValue[] | null;
}

interface AgentRuntime {
  messages: RuntimeMessage[];
  sending: boolean;
  streamingAssistantIndex: number | null;
  waitingAssistantIndex: number | null;
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
  customContextOpen: boolean;
  contextPreviewOpen: boolean;
  refreshers: Map<string, () => Promise<void>>;
}

const runtime: AgentRuntime = {
  messages: [],
  sending: false,
  streamingAssistantIndex: null,
  waitingAssistantIndex: null,
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
  customContextOpen: false,
  contextPreviewOpen: false,
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

function renderSectionBody(body: HTMLDivElement, item: Zotero.Item) {
  const doc = body.ownerDocument;
  if (!doc) {
    return;
  }
  const customContextKey = resolveCustomContextKey(item);
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
      if (index === runtime.waitingAssistantIndex) {
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
          models.length,
        );
      })
      .catch((error) => {
        runtime.modelFetchStatusKind = "error";
        runtime.modelFetchStatusMessage = formatModelFetchError(error);
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
      createdAt: Date.now(),
    });
    const requestMessages = toProviderMessages(runtime.messages);
    const templateID = runtime.templateID;
    const contextOptions = { ...runtime.contextOptions };
    const customContext = getCustomContextForKey(customContextKey);
    const assistantMessageIndex =
      runtime.messages.push({
        role: "assistant",
        content: "",
        createdAt: Date.now(),
      }) - 1;
    runtime.shouldAutoScroll = true;
    runtime.streamingAssistantIndex = null;
    startWaitingAnimation(assistantMessageIndex);
    input.value = "";
    void refreshAllSections();
    void sendMessage(
      buildRequestMessagesWithContext(requestMessages, {
        item,
        contextOptions,
        templateID,
        customContext,
      }),
      assistantMessageIndex,
      requestToken,
    ).finally(() => {
      if (requestToken !== runtime.requestToken) {
        return;
      }
      stopWaitingAnimation();
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
  root.append(messages, controls, composer);
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
        const assistantMessage = runtime.messages[assistantMessageIndex];
        if (!assistantMessage) {
          return;
        }
        if (!receivedStreamDelta) {
          receivedStreamDelta = true;
          stopWaitingAnimation();
          runtime.streamingAssistantIndex = assistantMessageIndex;
          assistantMessage.content = "";
        }
        assistantMessage.content += delta;
        runtime.shouldAutoScroll = true;
        queueStreamRefresh();
      },
    });
    if (requestToken !== runtime.requestToken) {
      return;
    }
    if (receivedStreamDelta) {
      const assistantMessage = runtime.messages[assistantMessageIndex];
      if (
        assistantMessage &&
        !assistantMessage.content.trim() &&
        reply.trim()
      ) {
        assistantMessage.content = reply;
      }
      runtime.streamingAssistantIndex = null;
      await refreshAllSections();
      return;
    }
    stopWaitingAnimation();
    runtime.streamingAssistantIndex = assistantMessageIndex;
    await streamAssistantReply(assistantMessageIndex, reply);
  } catch (error) {
    if (requestToken !== runtime.requestToken) {
      return;
    }
    stopWaitingAnimation();
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

function normalizeProviderID(value: unknown) {
  if (typeof value !== "string") {
    return "openai-compatible";
  }
  const normalized = value.trim().toLowerCase();
  return normalized || "openai-compatible";
}

function normalizeString(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  return normalized || fallback;
}

function normalizeReasoningEffort(value: unknown): ReasoningEffortValue {
  if (typeof value !== "string") {
    return "default";
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, "");
  if (normalized === "extra" || normalized === "extrahigh") {
    return "xhigh";
  }
  return REASONING_EFFORT_VALUES.includes(normalized as ReasoningEffortValue)
    ? (normalized as ReasoningEffortValue)
    : "default";
}

function getDefaultModelForProvider(_providerID: string) {
  return FALLBACK_MODEL_ID;
}

function buildModelSourceKey(providerID: string, baseURL: string) {
  return `${normalizeProviderID(providerID)}|${normalizeBaseURL(baseURL)}`;
}

function normalizeBaseURL(baseURL: string) {
  return baseURL.trim().replace(/\/+$/, "");
}

function resolveModelOptions(
  providerID: string,
  baseURL: string,
  currentModel: string,
  cache: Map<string, string[]>,
) {
  const cached = cache.get(buildModelSourceKey(providerID, baseURL));
  if (cached?.length) {
    return cached;
  }
  return currentModel ? [currentModel] : [FALLBACK_MODEL_ID];
}

function buildModelContextMap(modelInfos: ModelInfo[]) {
  const contextByModel = new Map<string, number>();
  for (const modelInfo of modelInfos) {
    if (modelInfo.contextWindow && modelInfo.contextWindow > 0) {
      contextByModel.set(modelInfo.id, modelInfo.contextWindow);
    }
  }
  return contextByModel;
}

function buildModelReasoningMap(modelInfos: ModelInfo[]) {
  const reasoningByModel = new Map<string, ReasoningEffortValue[]>();
  for (const modelInfo of modelInfos) {
    if (modelInfo.reasoningEfforts?.length) {
      reasoningByModel.set(modelInfo.id, modelInfo.reasoningEfforts);
    }
  }
  return reasoningByModel;
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

function resolveEffectiveReasoningEffort(
  options: readonly ReasoningEffortValue[],
  requested: ReasoningEffortValue,
) {
  return options.includes(requested) ? requested : "default";
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

function getModelsFetchedMessage(count: number) {
  return Zotero.locale.startsWith("zh")
    ? `已从站点获取 ${count} 个模型。`
    : `Fetched ${count} models from site.`;
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
      const modelInfos = parseModelInfos(request.responseText || "");
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

function buildModelEndpointCandidates(baseURL: string) {
  const endpoints: string[] = [];
  const trimmed = baseURL.trim();
  if (!trimmed) {
    return endpoints;
  }
  addCandidateEndpoint(endpoints, trimmed);
  if (!/\/models(?:[/?#]|$)/i.test(trimmed)) {
    addCandidateEndpoint(endpoints, `${trimmed.replace(/\/+$/, "")}/models`);
  }
  const stripped = trimmed.replace(
    /\/(chat\/completions|responses|completions)(?:[/?#].*)?$/i,
    "",
  );
  if (stripped !== trimmed) {
    addCandidateEndpoint(endpoints, `${stripped.replace(/\/+$/, "")}/models`);
  }
  try {
    const parsed = new URL(trimmed);
    addCandidateEndpoint(endpoints, `${parsed.origin}/v1/models`);
    addCandidateEndpoint(endpoints, `${parsed.origin}/models`);
  } catch (_error) {
    // Ignore invalid URL parse and keep literal candidates.
  }
  return endpoints;
}

function addCandidateEndpoint(target: string[], endpoint: string) {
  const normalized = endpoint.trim();
  if (!normalized || target.includes(normalized)) {
    return;
  }
  target.push(normalized);
}

function parseModelIDs(responseText: string) {
  return parseModelInfos(responseText).map((modelInfo) => modelInfo.id);
}

function parseModelInfos(responseText: string): ModelInfo[] {
  const trimmed = responseText.trim();
  if (!trimmed) {
    throw new ModelProbeError("empty_model_list", getEmptyModelListMessage());
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    throw new ModelProbeError(
      "non_json",
      Zotero.locale.startsWith("zh")
        ? "站点返回的不是 JSON。"
        : "Site did not return JSON.",
    );
  }
  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch (_error) {
    throw new ModelProbeError(
      "invalid_json",
      Zotero.locale.startsWith("zh")
        ? "站点返回 JSON 解析失败。"
        : "Failed to parse JSON from site.",
    );
  }
  let foundModelArray = false;
  const items: unknown[] = [];
  if (Array.isArray(payload)) {
    foundModelArray = true;
    items.push(...payload);
  } else if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["data", "models", "items", "result", "results"]) {
      const value = record[key];
      if (Array.isArray(value)) {
        foundModelArray = true;
        items.push(...value);
      }
    }
  }
  if (!foundModelArray) {
    throw new ModelProbeError("no_model_list", getNoModelListMessage());
  }
  const modelInfos: ModelInfo[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      const value = item.trim();
      if (value && !modelInfos.some((modelInfo) => modelInfo.id === value)) {
        modelInfos.push({
          id: value,
          contextWindow: null,
          reasoningEfforts: null,
        });
      }
      continue;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const record = item as Record<string, unknown>;
    const modelID = [record.id, record.model, record.name]
      .find((candidate) => typeof candidate === "string")
      ?.toString()
      .trim();
    if (modelID && !modelInfos.some((modelInfo) => modelInfo.id === modelID)) {
      modelInfos.push({
        id: modelID,
        contextWindow: extractModelContextWindow(record),
        reasoningEfforts: extractModelReasoningEfforts(record),
      });
    }
  }
  if (!modelInfos.length) {
    throw new ModelProbeError("empty_model_list", getEmptyModelListMessage());
  }
  return modelInfos;
}

function extractModelContextWindow(record: Record<string, unknown>) {
  const candidates = [
    record.context_length,
    record.context_window,
    record.contextWindow,
    record.max_context_length,
    record.max_context_tokens,
    record.max_model_len,
    record.max_sequence_length,
    record.input_token_limit,
    record.max_input_tokens,
  ];
  for (const candidate of candidates) {
    const normalized = normalizePositiveInteger(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function normalizePositiveInteger(value: unknown) {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : 0;
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }
  return Math.floor(numberValue);
}

function extractModelReasoningEfforts(record: Record<string, unknown>) {
  const candidates = [
    record.reasoning_efforts,
    record.supported_reasoning_efforts,
    record.reasoningEfforts,
    record.supportedReasoningEfforts,
    record.reasoning_effort_values,
    record.supported_reasoning_levels,
    readNestedValue(record, ["reasoning", "efforts"]),
    readNestedValue(record, ["reasoning", "supported_efforts"]),
    readNestedValue(record, ["reasoning", "supportedReasoningEfforts"]),
    readNestedValue(record, ["capabilities", "reasoning_efforts"]),
    readNestedValue(record, ["capabilities", "supported_reasoning_efforts"]),
  ];
  const output: ReasoningEffortValue[] = [];
  for (const candidate of candidates) {
    for (const value of normalizeReasoningEffortList(candidate)) {
      if (!output.includes(value)) {
        output.push(value);
      }
    }
  }
  return output.length ? output : null;
}

function readNestedValue(record: Record<string, unknown>, path: string[]) {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function normalizeReasoningEffortList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(normalizeReasoningEffort)
      .filter((entry) => entry !== "default");
  }
  if (typeof value === "string") {
    return value
      .split(/[,\s|/]+/)
      .map(normalizeReasoningEffort)
      .filter((entry) => entry !== "default");
  }
  return [];
}

function canRetryModelEndpoint(index: number, total: number, error: Error) {
  if (index >= total - 1) {
    return false;
  }
  if (error instanceof ModelProbeError) {
    return true;
  }
  const statusCode = parseStatusCodeFromError(error);
  if (statusCode === 404 || statusCode === 405) {
    return true;
  }
  const text = error.message.toLowerCase();
  return (
    text.includes("not found") ||
    text.includes("unsupported endpoint") ||
    text.includes("cannot get")
  );
}

function parseStatusCodeFromError(error: Error) {
  const match = error.message.match(/\b(\d{3})\b/);
  if (!match) {
    return 0;
  }
  const code = Number(match[1]);
  return Number.isFinite(code) ? code : 0;
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

function resolveCustomContextKey(item: Zotero.Item | null) {
  const primaryItem = resolvePrimaryContextItem(item);
  if (!primaryItem?.key) {
    return "__global__";
  }
  const libraryID =
    typeof primaryItem.libraryID === "number"
      ? String(primaryItem.libraryID)
      : "unknown";
  return `${libraryID}:${primaryItem.key}`;
}

function resolvePrimaryContextItem(item: Zotero.Item | null) {
  if (!item) {
    return null;
  }
  let current: Zotero.Item = item;
  let guard = 0;
  while (current.parentItem && guard < 6) {
    current = current.parentItem;
    guard += 1;
  }
  return current;
}

function getCustomContextForKey(customContextKey: string) {
  return runtime.customContextByItemKey.get(customContextKey) || "";
}

function setCustomContextForKey(customContextKey: string, value: string) {
  if (value.trim()) {
    runtime.customContextByItemKey.set(customContextKey, value);
    return;
  }
  runtime.customContextByItemKey.delete(customContextKey);
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

function startWaitingAnimation(assistantMessageIndex: number) {
  runtime.waitingAssistantIndex = assistantMessageIndex;
  runtime.waitingStartedAt = Date.now();
  runtime.waitingStep = 0;
  runtime.waitingToken += 1;
  const token = runtime.waitingToken;
  void runWaitingLoop(token);
}

function stopWaitingAnimation() {
  const waitingIndex = runtime.waitingAssistantIndex;
  if (waitingIndex !== null && runtime.waitingStartedAt !== null) {
    const assistantMessage = runtime.messages[waitingIndex];
    if (assistantMessage && assistantMessage.responseWaitMs === undefined) {
      assistantMessage.responseWaitMs = Math.max(
        0,
        Date.now() - runtime.waitingStartedAt,
      );
    }
  }
  runtime.waitingAssistantIndex = null;
  runtime.waitingStartedAt = null;
  runtime.waitingStep = 0;
  runtime.waitingToken += 1;
}

async function runWaitingLoop(token: number) {
  while (
    runtime.waitingAssistantIndex !== null &&
    runtime.waitingToken === token &&
    runtime.sending
  ) {
    runtime.waitingStep = (runtime.waitingStep + 1) % 3;
    await refreshAllSections();
    await Zotero.Promise.delay(320);
  }
}

function isAbortError(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return /cancel|abort/i.test(text);
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

function createContextToggle(
  doc: Document,
  labelKey:
    | "agent-context-metadata"
    | "agent-context-notes"
    | "agent-context-annotations"
    | "agent-context-selected-text",
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
  const preview = buildContextPreview({
    item,
    contextOptions: runtime.contextOptions,
    templateID: runtime.templateID,
    customContext: getCustomContextForKey(customContextKey),
  });
  const modelContextWindow = resolveModelContextWindow(
    modelRef.providerID,
    modelRef.baseURL,
    modelRef.model,
  );
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

function renderMessageMarkdown(container: HTMLElement, source: string) {
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

export const sectionTestUtils = {
  buildModelEndpointCandidates,
  parseModelIDs,
  parseModelInfos,
  resolveEffectiveReasoningEffort,
  resolveCustomContextKey,
  canRetryModelEndpointError(index: number, total: number, error: Error) {
    return canRetryModelEndpoint(index, total, error);
  },
};
