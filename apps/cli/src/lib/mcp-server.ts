// The name every agent's config gives the Clocktopus MCP server, and so the one
// its sign-in command takes (`codex mcp login clocktopus`).
export const MCP_SERVER_NAME = "clocktopus";

export function mcpServerUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/$/, "")}/api/mcp`;
}
