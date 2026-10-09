import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Plugin } from "@opencode/plugin"

type Context = Parameters<NonNullable<ReturnType<typeof Plugin.define>["setup"]>>[0]
export type OpenAICredential =
  | { mode: "api"; key: string }
  | { mode: "oauth"; access: string; accountId?: string }

/** Resolve credentials at tool execution time so any agent/model can use the tools. */
export async function resolveCredential(ctx: Context): Promise<OpenAICredential> {
  const fromEnv = process.env.OPENAI_API_KEY?.trim()
  if (fromEnv) return { mode: "api", key: fromEnv }

  const connection = await ctx.integration.connection.active("openai")
  const credential = connection && await ctx.integration.connection.resolve(connection)
  if (credential?.type === "key") return { mode: "api", key: credential.key }
  if (credential?.type === "oauth") {
    if (credential.expires <= Date.now()) {
      throw new Error("OpenAI OAuth session expired. Reconnect OpenAI in OpenCode before generating images.")
    }
    const metadata = credential.metadata as { accountId?: unknown } | undefined
    return {
      mode: "oauth",
      access: credential.access,
      ...(typeof metadata?.accountId === "string" ? { accountId: metadata.accountId } : {}),
    }
  }

  const keyFile = process.env.OPENCODE_OPENAI_KEY_FILE?.trim() ||
    path.join(os.homedir(), ".config", "opencode", "openai.key")
  try {
    const key = (await readFile(keyFile, "utf8")).trim()
    if (key) return { mode: "api", key }
  } catch { /* no fallback key file */ }
  throw new Error("No OpenAI credential found. Connect OpenAI in OpenCode, set OPENAI_API_KEY, or provide an OpenAI key file.")
}
