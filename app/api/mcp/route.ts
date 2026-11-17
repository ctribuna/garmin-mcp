/** MCP endpoint authenticated with `Authorization: Bearer <MCP_AUTH_TOKEN>`. */

import { handleMcp } from "@/mcp/handler";

export const maxDuration = 60;

async function handler(request: Request): Promise<Response> {
  return handleMcp(request);
}

export { handler as GET, handler as POST, handler as DELETE };
