/** The HTTP handler shared by both MCP routes. */

import { createMcpHandler } from "mcp-handler";
import { authorize } from "@/lib/auth";
import { registerAll, SERVER_INFO, SERVER_INSTRUCTIONS } from "./server";

const mcp = createMcpHandler((server) => registerAll(server), {
  serverInfo: SERVER_INFO,
  instructions: SERVER_INSTRUCTIONS,
});

export function handleMcp(request: Request, pathKey?: string): Promise<Response> | Response {
  return authorize(request, pathKey) ?? mcp(request);
}
