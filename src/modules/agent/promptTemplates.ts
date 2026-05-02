import { getString } from "../../utils/locale";

export interface PromptTemplate {
  id: string;
  label: string;
  systemPrompt: string;
}

export const DEFAULT_PROMPT_TEMPLATE_ID = "general";

interface PromptTemplateDef {
  id: string;
  labelKey:
    | "agent-template-general"
    | "agent-template-summarize"
    | "agent-template-critique"
    | "agent-template-related-work";
  systemPrompt: {
    en: string;
    zh: string;
  };
}

const PROMPT_TEMPLATE_DEFS: PromptTemplateDef[] = [
  {
    id: "general",
    labelKey: "agent-template-general",
    systemPrompt: {
      en: "You are Zotero Agent. Use provided Zotero context when it is relevant, and clearly distinguish facts from suggestions.",
      zh: "你是 Zotero Agent。请在相关时使用提供的 Zotero 上下文，并清楚区分事实与建议。",
    },
  },
  {
    id: "summarize",
    labelKey: "agent-template-summarize",
    systemPrompt: {
      en: "You are Zotero Agent. Summarize the selected research item with a concise structure: problem, method, key findings, and limitations.",
      zh: "你是 Zotero Agent。请用简洁结构总结选中的研究条目：问题、方法、关键发现和局限。",
    },
  },
  {
    id: "critique",
    labelKey: "agent-template-critique",
    systemPrompt: {
      en: "You are Zotero Agent. Critically evaluate research design, assumptions, evidence quality, and potential validity threats.",
      zh: "你是 Zotero Agent。请批判性评估研究设计、假设、证据质量和潜在效度威胁。",
    },
  },
  {
    id: "related-work",
    labelKey: "agent-template-related-work",
    systemPrompt: {
      en: "You are Zotero Agent. Help draft related-work analysis by comparing themes, methods, and gaps with actionable follow-up directions.",
      zh: "你是 Zotero Agent。请通过比较主题、方法和研究空白，帮助撰写相关工作分析，并给出可执行的后续方向。",
    },
  },
];

export function getPromptTemplates() {
  const language = getPromptLanguage();
  return PROMPT_TEMPLATE_DEFS.map((def) => ({
    id: def.id,
    label: getString(def.labelKey),
    systemPrompt: def.systemPrompt[language],
  }));
}

export function getPromptTemplateByID(templateID: string) {
  const normalized = templateID.trim().toLowerCase();
  const templates = getPromptTemplates();
  return (
    templates.find((template) => template.id === normalized) || templates[0]
  );
}

function getPromptLanguage(): "en" | "zh" {
  return Zotero.locale.startsWith("zh") ? "zh" : "en";
}
