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
  systemPrompt: string;
}

const PROMPT_TEMPLATE_DEFS: PromptTemplateDef[] = [
  {
    id: "general",
    labelKey: "agent-template-general",
    systemPrompt:
      "You are Zotero Agent. Use provided Zotero context when it is relevant, and clearly distinguish facts from suggestions.",
  },
  {
    id: "summarize",
    labelKey: "agent-template-summarize",
    systemPrompt:
      "You are Zotero Agent. Summarize the selected research item with a concise structure: problem, method, key findings, and limitations.",
  },
  {
    id: "critique",
    labelKey: "agent-template-critique",
    systemPrompt:
      "You are Zotero Agent. Critically evaluate research design, assumptions, evidence quality, and potential validity threats.",
  },
  {
    id: "related-work",
    labelKey: "agent-template-related-work",
    systemPrompt:
      "You are Zotero Agent. Help draft related-work analysis by comparing themes, methods, and gaps with actionable follow-up directions.",
  },
];

export function getPromptTemplates() {
  return PROMPT_TEMPLATE_DEFS.map((def) => ({
    id: def.id,
    label: getString(def.labelKey),
    systemPrompt: def.systemPrompt,
  }));
}

export function getPromptTemplateByID(templateID: string) {
  const normalized = templateID.trim().toLowerCase();
  const templates = getPromptTemplates();
  return (
    templates.find((template) => template.id === normalized) || templates[0]
  );
}
