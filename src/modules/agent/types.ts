export type AgentRole = "system" | "user" | "assistant";

export interface AgentMessage {
  role: AgentRole;
  content: string;
}
