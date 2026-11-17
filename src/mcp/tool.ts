/** Shared plumbing for registering MCP tools. */

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { GarminApi } from "@/garmin/api";
import { getGarminClient } from "@/garmin/client";

export interface ToolContext {
  server: McpServer;
  api: GarminApi;
  /** Whether tools that modify Garmin data may be registered. */
  writeEnabled: boolean;
}

export function createContext(server: McpServer, writeEnabled: boolean): ToolContext {
  return { server, api: new GarminApi(getGarminClient()), writeEnabled };
}

interface ToolConfig<Shape extends z.ZodRawShape> {
  title: string;
  description: string;
  input: Shape;
  /** Marks a tool that changes data in Garmin Connect. */
  write?: boolean;
  /** Marks a write that removes data. */
  destructive?: boolean;
}

export const dateParam = (what = "Date") =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .describe(`${what} as YYYY-MM-DD. Defaults to today in the user's timezone.`);

export const startParam = (defaultDays: number) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .describe(`First day (YYYY-MM-DD). Defaults to ${defaultDays} days ending at end_date.`);

export const endParam = () =>
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
    .optional()
    .describe("Last day (YYYY-MM-DD), inclusive. Defaults to today.");

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Register a tool whose handler returns plain data. Results are serialised as
 * compact JSON; failures become `isError` results the model can read and act
 * on instead of protocol-level errors.
 */
export function defineTool<Shape extends z.ZodRawShape>(
  ctx: ToolContext,
  name: string,
  config: ToolConfig<Shape>,
  handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<unknown>,
): void {
  if (config.write && !ctx.writeEnabled) return;

  ctx.server.registerTool(
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: z.object(config.input),
      annotations: {
        readOnlyHint: !config.write,
        destructiveHint: Boolean(config.destructive),
        idempotentHint: !config.write,
        openWorldHint: true,
      },
    },
    async (args: unknown) => {
      try {
        const result = await handler(args as z.infer<z.ZodObject<Shape>>);
        const empty =
          result === null ||
          result === undefined ||
          (Array.isArray(result) && result.length === 0) ||
          (typeof result === "object" && Object.keys(result as object).length === 0);
        const text = empty
          ? "No data recorded in Garmin Connect for this request."
          : JSON.stringify(result);
        return { content: [{ type: "text" as const, text }] };
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(error)}` }],
          isError: true,
        };
      }
    },
  );
}

/** Resolve a set of independent lookups, turning individual failures into notes. */
export async function gather<T extends Record<string, Promise<unknown>>>(
  parts: T,
): Promise<Record<string, unknown>> {
  const keys = Object.keys(parts);
  const settled = await Promise.allSettled(Object.values(parts));
  const out: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  settled.forEach((result, index) => {
    const key = keys[index] as string;
    if (result.status === "fulfilled") out[key] = result.value;
    else errors[key] = errorMessage(result.reason);
  });
  // If nothing at all could be loaded, surface the failure instead of an empty result.
  if (keys.length > 0 && Object.keys(errors).length === keys.length) {
    throw new Error(Object.values(errors)[0]);
  }
  if (Object.keys(errors).length > 0) out.unavailable = errors;
  return out;
}
