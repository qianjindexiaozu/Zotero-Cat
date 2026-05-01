import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";
import {
  getProviderApiKey,
  migrateLegacyApiKey,
  setProviderApiKey,
} from "./agent/secureApiKey";

interface ProviderPreset {
  id: string;
  label: string;
  defaultBaseUrl: string;
  models: string[];
}

const CUSTOM_MODEL_VALUE = "__custom__";

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openai-compatible",
    label: "OpenAI Compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
  },
  {
    id: "openai",
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    models: [
      "openai/gpt-4o",
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-sonnet",
      "google/gemini-2.0-flash-001",
      "deepseek/deepseek-chat",
      "meta-llama/llama-3.3-70b-instruct",
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com",
    models: ["deepseek-chat", "deepseek-reasoner"],
  },
  {
    id: "kimi",
    label: "Moonshot Kimi",
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
  {
    id: "qwen",
    label: "Qwen (DashScope)",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-turbo", "qwen-plus", "qwen-max"],
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    defaultBaseUrl: "http://127.0.0.1:11434/v1",
    models: ["qwen2.5:7b", "llama3.1:8b", "deepseek-r1:latest"],
  },
];

export function registerPrefsScripts(window: Window) {
  const doc = window.document;
  const providerSelect = doc.querySelector<HTMLSelectElement>(
    `#zotero-prefpane-${config.addonRef}-provider-select`,
  );
  const modelSelect = doc.querySelector<HTMLSelectElement>(
    `#zotero-prefpane-${config.addonRef}-model-select`,
  );
  const modelCustomInput = doc.querySelector<HTMLInputElement>(
    `#zotero-prefpane-${config.addonRef}-model-custom`,
  );
  const baseUrlInput = doc.querySelector<HTMLInputElement>(
    `#zotero-prefpane-${config.addonRef}-base-url`,
  );
  const apiKeyInput = doc.querySelector<HTMLInputElement>(
    `#zotero-prefpane-${config.addonRef}-api-key`,
  );
  if (
    !providerSelect ||
    !modelSelect ||
    !modelCustomInput ||
    !baseUrlInput ||
    !apiKeyInput
  ) {
    return;
  }

  const provider = normalizeProvider(getPref("provider"));
  const model = normalizeString(getPref("openaiModel"), "gpt-4o-mini");
  const baseUrl = normalizeString(getPref("openaiBaseUrl"), "");
  setPref("provider", provider);

  renderProviderOptions(providerSelect);
  providerSelect.value = provider;
  renderModelOptions(modelSelect, provider);
  syncModelUI(modelSelect, modelCustomInput, provider, model);
  if (baseUrl) {
    baseUrlInput.value = baseUrl;
  } else {
    autoFillBaseUrl(baseUrlInput, provider, true);
  }
  void syncApiKeyInput(apiKeyInput, provider);

  providerSelect.addEventListener("change", () => {
    const nextProvider = normalizeProvider(providerSelect.value);
    const currentModel = normalizeString(getPref("openaiModel"), "gpt-4o-mini");
    setPref("provider", nextProvider);
    autoFillBaseUrl(baseUrlInput, nextProvider, true);
    renderModelOptions(modelSelect, nextProvider);
    syncModelUI(modelSelect, modelCustomInput, nextProvider, currentModel);
    void syncApiKeyInput(apiKeyInput, nextProvider);
  });

  modelSelect.addEventListener("change", () => {
    if (modelSelect.value === CUSTOM_MODEL_VALUE) {
      modelCustomInput.disabled = false;
      modelCustomInput.focus();
      const customValue = normalizeString(modelCustomInput.value, "");
      if (customValue) {
        setPref("openaiModel", customValue);
      }
      return;
    }
    modelCustomInput.disabled = true;
    modelCustomInput.value = "";
    setPref("openaiModel", modelSelect.value);
  });

  modelCustomInput.addEventListener("input", () => {
    if (modelSelect.value !== CUSTOM_MODEL_VALUE) {
      return;
    }
    const customValue = normalizeString(modelCustomInput.value, "");
    if (!customValue) {
      return;
    }
    setPref("openaiModel", customValue);
  });

  apiKeyInput.addEventListener("change", () => {
    void saveApiKey(providerSelect.value, apiKeyInput.value);
  });

  apiKeyInput.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    apiKeyInput.blur();
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

function renderModelOptions(select: HTMLSelectElement, provider: string) {
  const doc = select.ownerDocument;
  if (!doc) {
    return;
  }
  select.replaceChildren();
  const preset = getProviderPreset(provider);
  for (const model of preset.models) {
    const option = doc.createElement("option");
    option.value = model;
    option.textContent = model;
    select.appendChild(option);
  }
  const customOption = doc.createElement("option");
  customOption.value = CUSTOM_MODEL_VALUE;
  customOption.textContent = getCustomLabel();
  select.appendChild(customOption);
}

function syncModelUI(
  select: HTMLSelectElement,
  customInput: HTMLInputElement,
  provider: string,
  currentModel: string,
) {
  const preset = getProviderPreset(provider);
  if (preset.models.includes(currentModel)) {
    select.value = currentModel;
    customInput.disabled = true;
    customInput.value = "";
    return;
  }
  select.value = CUSTOM_MODEL_VALUE;
  customInput.disabled = false;
  customInput.value = currentModel;
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
  setPref("openaiBaseUrl", preset.defaultBaseUrl);
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

function getCustomLabel() {
  return Zotero.locale.startsWith("zh") ? "自定义模型" : "Custom model";
}

async function syncApiKeyInput(input: HTMLInputElement, provider: string) {
  try {
    await migrateLegacyApiKey(provider);
    input.value = getProviderApiKey(provider);
  } catch (error) {
    Zotero.log(
      `[${config.addonName}] Failed to load API key: ${String(error)}`,
      "error",
    );
    input.value = "";
  }
}

async function saveApiKey(provider: string, value: string) {
  try {
    await setProviderApiKey(provider, normalizeString(value, ""));
  } catch (error) {
    Zotero.log(
      `[${config.addonName}] Failed to save API key: ${String(error)}`,
      "error",
    );
  }
}
