import type { AgentPart } from "@aihot/web/modules";
import { mcpToolName } from "@aihot/contracts/mcp";
import { AGENT_SECTIONS, MODULE_AGENT_TOOLS } from "../agent.ts";

export function platformAgentPart(name: string): AgentPart {
  const tools = MODULE_AGENT_TOOLS.filter(tool => tool.section === name);
  return {
    tools: tools.map(tool => ({ name: mcpToolName(tool.tool), does: `${tool.title}；参数：${tool.parameters}`, ask: tool.ask })),
    ...(tools.length ? { api: { group: AGENT_SECTIONS.find(section => section.id === name)!.name,
      rows: tools.map(tool => [`/api/v1/agent${tool.path}`, `${tool.ask}；${tool.parameters}`, "需要时读取（no-store）"] as [string, string, string]) } } : {}),
  };
}
