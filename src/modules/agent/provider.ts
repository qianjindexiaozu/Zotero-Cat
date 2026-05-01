import { getPref } from "../../utils/prefs";
import { getString } from "../../utils/locale";

export type AgentRole = "system" | "user" | "assistant";

export interface AgentMessage {
  role: AgentRole;
  content: string;
}

export interface ChatProvider {
  readonly id: string;
  chat(messages: AgentMessage[], options?: ChatOptions): Promise<string>;
}

export interface ChatOptions {
  onCanceller?(cancel: () => void): void;
}

interface ProviderSettings {
  provider: string;
  openaiBaseUrl: string;
  openaiModel: string;
  openaiApiKey: string;
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

const OPENAI_COMPATIBLE_PROVIDER_IDS = new Set([
  "openai-compatible",
  "openai",
  "openrouter",
  "deepseek",
  "kimi",
  "qwen",
  "ollama",
]);

export function createProviderFromPrefs(): ChatProvider {
  const settings = readProviderSettings();
  const providerID = settings.provider.trim().toLowerCase();
  if (OPENAI_COMPATIBLE_PROVIDER_IDS.has(providerID)) {
    return new OpenAICompatibleProvider(settings);
  }
  throw new Error(
    getString("agent-error-unsupported-provider", {
      args: { provider: settings.provider },
    }),
  );
}

function readProviderSettings(): ProviderSettings {
  return {
    provider: sanitizeString(getPref("provider"), "openai-compatible"),
    openaiBaseUrl: sanitizeString(
      getPref("openaiBaseUrl"),
      "https://api.openai.com/v1",
    ),
    openaiModel: sanitizeString(getPref("openaiModel"), "gpt-4o-mini"),
    openaiApiKey: sanitizeString(getPref("openaiApiKey"), ""),
  };
}

function sanitizeString(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim();
  return normalized.length ? normalized : fallback;
}

class OpenAICompatibleProvider implements ChatProvider {
  readonly id = "openai-compatible";

  constructor(private readonly settings: ProviderSettings) {}

  async chat(messages: AgentMessage[], options?: ChatOptions): Promise<string> {
    if (!this.settings.openaiApiKey) {
      throw new Error(getString("agent-error-missing-api-key"));
    }
    if (!this.settings.openaiBaseUrl) {
      throw new Error(getString("agent-error-missing-base-url"));
    }
    if (!this.settings.openaiModel) {
      throw new Error(getString("agent-error-missing-model"));
    }
    const endpoint = `${this.settings.openaiBaseUrl.replace(/\/+$/, "")}/chat/completions`;
    const payload = {
      model: this.settings.openaiModel,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    };
    const request = await Zotero.HTTP.request("POST", endpoint, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.openaiApiKey}`,
      },
      body: JSON.stringify(payload),
      timeout: 60_000,
      cancellerReceiver(canceller: () => void) {
        if (!options?.onCanceller) {
          return;
        }
        options.onCanceller(() => {
          try {
            canceller();
          } catch (_error) {
            // Ignore cancellation race errors.
          }
        });
      },
    });
    const responseText = request.responseText || "{}";
    const response = JSON.parse(responseText) as OpenAIChatResponse;
    if (response.error?.message) {
      throw new Error(response.error.message);
    }
    const output = extractContent(response);
    if (!output) {
      throw new Error(getString("agent-error-empty-response"));
    }
    return output;
  }
}

function extractContent(response: OpenAIChatResponse) {
  const firstChoice = response.choices?.[0]?.message?.content;
  if (!firstChoice) {
    return "";
  }
  if (typeof firstChoice === "string") {
    return firstChoice.trim();
  }
  return firstChoice
    .map((part) => {
      if (part.type === "text") {
        return part.text || "";
      }
      return "";
    })
    .join("")
    .trim();
}
