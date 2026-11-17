/** MCP endpoint with the secret in the URL: https://<host>/api/mcp/<MCP_AUTH_TOKEN> */

import { handleMcp } from "@/mcp/handler";

export const maxDuration = 60;

type Context = { params: Promise<{ key: string }> };

async function handler(request: Request, context: Context): Promise<Response> {
  const { key } = await context.params;
  return handleMcp(request, key);
}

export { handler as GET, handler as POST, handler as DELETE };
