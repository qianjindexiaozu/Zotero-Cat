import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";
import {
  getProviderApiKey,
  migrateLegacyApiKey,
  setProviderApiKey,
} from "./agent/secureApiKey";
import { isApiKeyRequiredForProvider } from "./agent/provider";

interface ProviderPreset {
  id: string;
  label: string;
  defaultBaseUrl: string;
}

interface PrefFormState {
  provider: string;
  baseUrl: string;
  apiKey: string;
}

type ModelProbeErrorCode =
  | "non_json"
  | "invalid_json"
  | "no_model_list"
  | "empty_model_list";

class ModelProbeError extends Error {
  constructor(
    readonly code: ModelProbeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ModelProbeError";
  }
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai-compatible",
    label: "OpenAI Compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com",
  },
  {
    id: "kimi",
    label: "Moonshot Kimi",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
  },
  {
    id: "qwen",
    label: "Qwen (DashScope)",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
  },
];

export function registerPrefsScripts(window: Window) {
  const doc = window.document;
  const providerSelect = doc.querySelector<HTMLSelectElement>(
    `#zotero-prefpane-${config.addonRef}-provider-select`,
  );
  const baseUrlInput = doc.querySelector<HTMLInputElement>(
    `#zotero-prefpane-${config.addonRef}-base-url`,
  );
  const apiKeyInput = doc.querySelector<HTMLInputElement>(
    `#zotero-prefpane-${config.addonRef}-api-key`,
  );
  const saveButton = doc.querySelector<HTMLButtonElement>(
    `#zotero-prefpane-${config.addonRef}-save`,
  );
  const testButton = doc.querySelector<HTMLButtonElement>(
    `#zotero-prefpane-${config.addonRef}-test`,
  );
  const saveStatus = doc.querySelector<HTMLDivElement>(
    `#zotero-prefpane-${config.addonRef}-save-status`,
  );
  const saveStatusCopyButton = doc.querySelector<HTMLButtonElement>(
    `#zotero-prefpane-${config.addonRef}-save-status-copy`,
  );
  if (
    !providerSelect ||
    !baseUrlInput ||
    !apiKeyInput ||
    !saveButton ||
    !testButton ||
    !saveStatus ||
    !saveStatusCopyButton
  ) {
    return;
  }

  let saving = false;
  let testing = false;
  let apiKeySyncToken = 0;

  saveStatusCopyButton.textContent = getCopyDetailLabel();
  saveStatusCopyButton.addEventListener("click", () => {
    const text = saveStatus.textContent?.trim() || "";
    if (!text || !copyText(text)) {
      return;
    }
    const view = saveStatusCopyButton.ownerDocument?.defaultView;
    saveStatusCopyButton.textContent = getCopiedDetailLabel();
    view?.setTimeout(() => {
      saveStatusCopyButton.textContent = getCopyDetailLabel();
    }, 900);
  });

  const syncApiKeyForSelection = (providerID: string, baseURL: string) => {
    const token = ++apiKeySyncToken;
    return loadApiKey(providerID, baseURL).then((apiKey) => {
      if (token !== apiKeySyncToken) {
        return false;
      }
      apiKeyInput.value = apiKey;
      return true;
    });
  };

  const provider = normalizeProvider(getPref("provider"));
  const baseUrl = normalizeString(getPref("openaiBaseUrl"), "");
  setPref("provider", provider);

  renderProviderOptions(providerSelect);
  providerSelect.value = provider;
  if (baseUrl) {
    baseUrlInput.value = baseUrl;
  } else {
    autoFillBaseUrl(baseUrlInput, provider, true);
  }
  clearSaveStatus(saveStatus, saveStatusCopyButton);

  let savedState: PrefFormState = readFormState(
    providerSelect,
    baseUrlInput,
    apiKeyInput,
  );

  const updateActionButtons = () => {
    const busy = saving || testing;
    const currentState = readFormState(
      providerSelect,
      baseUrlInput,
      apiKeyInput,
    );
    saveButton.disabled = busy || isSameState(currentState, savedState);
    testButton.disabled = busy;
  };

  const setDefaultLabels = () => {
    saveButton.textContent = getDefaultSaveLabel();
    testButton.textContent = getDefaultTestLabel();
  };

  setDefaultLabels();
  updateActionButtons();

  void syncApiKeyForSelection(provider, baseUrlInput.value).then(() => {
    savedState = readFormState(providerSelect, baseUrlInput, apiKeyInput);
    updateActionButtons();
  });

  providerSelect.addEventListener("change", () => {
    clearSaveStatus(saveStatus, saveStatusCopyButton);
    const nextProvider = normalizeProvider(providerSelect.value);
    autoFillBaseUrl(baseUrlInput, nextProvider, true);
    void syncApiKeyForSelection(nextProvider, baseUrlInput.value).then(() => {
      updateActionButtons();
    });
  });

  providerSelect.addEventListener("input", () => {
    clearSaveStatus(saveStatus, saveStatusCopyButton);
    updateActionButtons();
  });

  baseUrlInput.addEventListener("input", () => {
    clearSaveStatus(saveStatus, saveStatusCopyButton);
    updateActionButtons();
  });

  apiKeyInput.addEventListener("input", () => {
    clearSaveStatus(saveStatus, saveStatusCopyButton);
    updateActionButtons();
  });

  saveButton.addEventListener("click", () => {
    if (saveButton.disabled) {
      return;
    }
    const currentState = readFormState(
      providerSelect,
      baseUrlInput,
      apiKeyInput,
    );
    saving = true;
    saveButton.textContent = getSavingLabel();
    clearSaveStatus(saveStatus, saveStatusCopyButton);
    updateActionButtons();
    void persistFormState(currentState)
      .then(() => {
        savedState = currentState;
        saveButton.textContent = getSavedLabel();
        setSaveStatus(
          saveStatus,
          saveStatusCopyButton,
          "success",
          getSaveSuccessMessage(),
        );
      })
      .catch((error) => {
        saveButton.textContent = getSaveFailedLabel();
        setSaveStatus(
          saveStatus,
          saveStatusCopyButton,
          "error",
          getSaveFailedMessage(),
          formatSaveErrorDetail(error),
        );
      })
      .finally(() => {
        saving = false;
        const view = saveButton.ownerDocument?.defaultView;
        view?.setTimeout(() => {
          if (!saving && !testing) {
            setDefaultLabels();
            updateActionButtons();
          }
        }, 950);
        updateActionButtons();
      });
  });

  testButton.addEventListener("click", () => {
    if (testButton.disabled) {
      return;
    }
    const currentState = readFormState(
      providerSelect,
      baseUrlInput,
      apiKeyInput,
    );
    testing = true;
    testButton.textContent = getTestingLabel();
    clearSaveStatus(saveStatus, saveStatusCopyButton);
    updateActionButtons();
    void testConnection(currentState)
      .then((testResult) => {
        setSaveStatus(
          saveStatus,
          saveStatusCopyButton,
          "success",
          getTestSuccessMessage(testResult.endpoint, testResult.modelCount),
        );
      })
      .catch((error) => {
        setSaveStatus(
          saveStatus,
          saveStatusCopyButton,
          "error",
          getTestFailedMessage(),
          formatSaveErrorDetail(error),
        );
      })
      .finally(() => {
        testing = false;
        const view = testButton.ownerDocument?.defaultView;
        view?.setTimeout(() => {
          if (!saving && !testing) {
            setDefaultLabels();
            updateActionButtons();
          }
        }, 950);
        updateActionButtons();
      });
  });

  apiKeyInput.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    if (!saveButton.disabled) {
      saveButton.click();
    }
  });
}

function renderProviderOptions(select: HTMLSelectElement) {
  const doc = select.ownerDocument;
  if (!doc) {
    return;
  }
  select.replaceChildren();
  for (const provider of PROVIDER_PRESETS) {
    const option = doc.createElement("option");
    option.value = provider.id;
    option.textContent = provider.label;
    select.appendChild(option);
  }
}

function autoFillBaseUrl(
  baseUrlInput: HTMLInputElement,
  provider: string,
  force: boolean,
) {
  const preset = getProviderPreset(provider);
  if (!force && baseUrlInput.value.trim()) {
    return;
  }
  baseUrlInput.value = preset.defaultBaseUrl;
}

function getProviderPreset(provider: string) {
  return (
    PROVIDER_PRESETS.find((preset) => preset.id === provider) ||
    PROVIDER_PRESETS[0]
  );
}

function normalizeProvider(value: unknown) {
  if (typeof value !== "string") {
    return PROVIDER_PRESETS[0].id;
  }
  const normalized = value.trim().toLowerCase();
  return PROVIDER_PRESETS.some((preset) => preset.id === normalized)
    ? normalized
    : PROVIDER_PRESETS[0].id;
}

function normalizeString(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : fallback;
}

function readFormState(
  providerSelect: HTMLSelectElement,
  baseUrlInput: HTMLInputElement,
  apiKeyInput: HTMLInputElement,
): PrefFormState {
  return {
    provider: normalizeProvider(providerSelect.value),
    baseUrl: normalizeString(baseUrlInput.value, ""),
    apiKey: normalizeString(apiKeyInput.value, ""),
  };
}

function isSameState(left: PrefFormState, right: PrefFormState) {
  return (
    left.provider === right.provider &&
    left.baseUrl === right.baseUrl &&
    left.apiKey === right.apiKey
  );
}

async function loadApiKey(provider: string, baseURL: string) {
  try {
    await migrateLegacyApiKey(provider, baseURL);
    return getProviderApiKey(provider, baseURL);
  } catch (_error) {
    return "";
  }
}

async function persistFormState(state: PrefFormState) {
  setPref("provider", state.provider);
  setPref("openaiBaseUrl", state.baseUrl);
  await setProviderApiKey(state.provider, state.baseUrl, state.apiKey);
}

async function testConnection(state: PrefFormState) {
  const normalizedBaseURL = normalizeString(state.baseUrl, "");
  if (!normalizedBaseURL) {
    throw new Error(getMissingBaseUrlDetail());
  }
  if (
    isApiKeyRequiredForProvider(state.provider) &&
    !normalizeAuthKey(state.apiKey)
  ) {
    throw new Error(getMissingApiKeyDetail());
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const apiKey = normalizeAuthKey(state.apiKey);
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const candidates = buildModelsEndpointCandidates(normalizedBaseURL);
  let lastError: Error | null = null;
  for (const [index, endpoint] of candidates.entries()) {
    try {
      const request = await Zotero.HTTP.request("GET", endpoint, {
        headers,
        timeout: 25_000,
      });
      const responseText = request.responseText || "";
      const modelCount = countModels(responseText);
      return { endpoint, modelCount };
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error));
      if (canRetryTestEndpoint(index, candidates.length, normalizedError)) {
        lastError = normalizedError;
        continue;
      }
      throw normalizedError;
    }
  }
  throw lastError || new Error(getUnknownTestErrorDetail());
}

function buildModelsEndpointCandidates(baseURL: string) {
  const candidates: string[] = [];
  const trimmed = baseURL.trim();
  if (!trimmed) {
    return candidates;
  }
  addCandidate(candidates, trimmed);
  if (!/\/models(?:[/?#]|$)/i.test(trimmed)) {
    addCandidate(candidates, `${trimmed.replace(/\/+$/, "")}/models`);
  }
  const stripped = trimmed.replace(
    /\/(chat\/completions|responses|completions)(?:[/?#].*)?$/i,
    "",
  );
  if (stripped !== trimmed) {
    addCandidate(candidates, `${stripped.replace(/\/+$/, "")}/models`);
  }
  try {
    const url = new URL(trimmed);
    addCandidate(candidates, `${url.origin}/v1/models`);
    addCandidate(candidates, `${url.origin}/models`);
  } catch (_error) {
    // Ignore invalid URL parse and keep literal candidates above.
  }
  return candidates;
}

function addCandidate(candidates: string[], endpoint: string) {
  const normalized = endpoint.trim();
  if (!normalized || candidates.includes(normalized)) {
    return;
  }
  candidates.push(normalized);
}

function countModels(responseText: string) {
  const trimmed = responseText.trim();
  if (!trimmed) {
    throw new ModelProbeError("empty_model_list", getEmptyModelListDetail());
  }
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    throw new ModelProbeError("non_json", getNonJSONResponseDetail());
  }
  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch (_error) {
    throw new ModelProbeError("invalid_json", getInvalidJSONResponseDetail());
  }
  let foundModelArray = false;
  let items: unknown[] = [];
  if (Array.isArray(payload)) {
    foundModelArray = true;
    items = payload;
  } else if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["data", "models", "items", "result", "results"]) {
      const value = record[key];
      if (Array.isArray(value)) {
        foundModelArray = true;
        items = value;
        break;
      }
    }
  }
  if (!foundModelArray) {
    throw new ModelProbeError("no_model_list", getNoModelListDetail());
  }
  if (!items.length) {
    throw new ModelProbeError("empty_model_list", getEmptyModelListDetail());
  }
  return items.length;
}

function canRetryTestEndpoint(index: number, total: number, error: Error) {
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

function getDefaultSaveLabel() {
  return Zotero.locale.startsWith("zh") ? "保存设置" : "Save Settings";
}

function getSavingLabel() {
  return Zotero.locale.startsWith("zh") ? "保存中..." : "Saving...";
}

function getSavedLabel() {
  return Zotero.locale.startsWith("zh") ? "已保存" : "Saved";
}

function getSaveFailedLabel() {
  return Zotero.locale.startsWith("zh") ? "保存失败" : "Save Failed";
}

function getDefaultTestLabel() {
  return Zotero.locale.startsWith("zh") ? "测试连接" : "Test Connection";
}

function getTestingLabel() {
  return Zotero.locale.startsWith("zh") ? "测试中..." : "Testing...";
}

function getSaveSuccessMessage() {
  return Zotero.locale.startsWith("zh")
    ? "设置已保存。"
    : "Settings saved successfully.";
}

function getSaveFailedMessage() {
  return Zotero.locale.startsWith("zh")
    ? "设置保存失败。"
    : "Failed to save settings.";
}

function getTestSuccessMessage(endpoint: string, modelCount: number) {
  if (Zotero.locale.startsWith("zh")) {
    return `连接测试成功。接口：${endpoint}（模型数：${modelCount}）`;
  }
  return `Connection test passed. Endpoint: ${endpoint} (models: ${modelCount}).`;
}

function getTestFailedMessage() {
  return Zotero.locale.startsWith("zh")
    ? "连接测试失败。"
    : "Connection test failed.";
}

function getMissingBaseUrlDetail() {
  return Zotero.locale.startsWith("zh")
    ? "请先填写 Base URL。"
    : "Please provide the Base URL first.";
}

function getMissingApiKeyDetail() {
  return Zotero.locale.startsWith("zh")
    ? "当前 Provider 需要 API Key，请先填写 API Key。"
    : "This provider requires an API key. Please fill in API key first.";
}

function getNonJSONResponseDetail() {
  return Zotero.locale.startsWith("zh")
    ? "测试接口返回的不是 JSON。"
    : "Test endpoint did not return JSON.";
}

function getInvalidJSONResponseDetail() {
  return Zotero.locale.startsWith("zh")
    ? "测试接口返回 JSON 解析失败。"
    : "Failed to parse JSON from test endpoint.";
}

function getNoModelListDetail() {
  return Zotero.locale.startsWith("zh")
    ? "测试接口未返回模型列表字段。"
    : "Test endpoint did not return a model list field.";
}

function getEmptyModelListDetail() {
  return Zotero.locale.startsWith("zh")
    ? "测试接口返回了空模型列表。"
    : "Test endpoint returned an empty model list.";
}

function getUnknownTestErrorDetail() {
  return Zotero.locale.startsWith("zh")
    ? "连接测试失败，未命中可用接口。"
    : "Connection test failed, no usable endpoint found.";
}

function formatSaveErrorDetail(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw.trim();
  const lower = text.toLowerCase();
  if (
    lower.includes("ns_error_abort") ||
    lower.includes("abort") ||
    lower.includes("cancel")
  ) {
    return Zotero.locale.startsWith("zh")
      ? "你可能取消了系统钥匙串/密码库授权。请重试并在系统弹窗中允许保存。"
      : "You likely canceled system keychain/password-store authorization. Retry and allow access in the system prompt.";
  }
  if (
    lower.includes("primary password") ||
    lower.includes("master password") ||
    lower.includes("not available")
  ) {
    return Zotero.locale.startsWith("zh")
      ? "密码库当前不可用或被锁定，请先解锁系统钥匙串后重试。"
      : "The password store is unavailable or locked. Unlock your system keychain and retry.";
  }
  return (
    text ||
    (Zotero.locale.startsWith("zh")
      ? "未知错误，请重试。"
      : "Unknown error, please retry.")
  );
}

function setSaveStatus(
  statusBox: HTMLDivElement,
  copyButton: HTMLButtonElement,
  kind: "success" | "error",
  message: string,
  detail = "",
) {
  statusBox.hidden = false;
  statusBox.dataset.kind = kind;
  statusBox.textContent = detail ? `${message}\n${detail}` : message;
  copyButton.hidden = kind !== "error";
  if (kind === "error") {
    copyButton.textContent = getCopyDetailLabel();
  }
}

function clearSaveStatus(
  statusBox: HTMLDivElement,
  copyButton: HTMLButtonElement,
) {
  statusBox.hidden = true;
  statusBox.textContent = "";
  delete statusBox.dataset.kind;
  copyButton.hidden = true;
  copyButton.textContent = getCopyDetailLabel();
}

function getCopyDetailLabel() {
  return Zotero.locale.startsWith("zh") ? "复制详情" : "Copy Details";
}

function getCopiedDetailLabel() {
  return Zotero.locale.startsWith("zh") ? "已复制" : "Copied";
}

function copyText(text: string) {
  try {
    Zotero.Utilities.Internal.copyTextToClipboard(text);
    return true;
  } catch (_error) {
    return false;
  }
}

export const preferenceScriptTestUtils = {
  buildModelsEndpointCandidates,
  countModels,
  canRetryTestEndpoint(index: number, total: number, message: string) {
    return canRetryTestEndpoint(index, total, new Error(message));
  },
  canRetryTestEndpointError(index: number, total: number, error: Error) {
    return canRetryTestEndpoint(index, total, error);
  },
};
