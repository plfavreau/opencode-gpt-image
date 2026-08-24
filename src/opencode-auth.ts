import { readFileSync } from "fs"
import os from "os"
import path from "path"
import type { PluginInput } from "@opencode-ai/plugin"

/**
 * Reuse the OpenAI credential opencode itself already manages, instead of
 * requiring a second, plugin-specific setup step.
 *
 * This intentionally does NOT register a new `auth` provider/OAuth flow. Two
 * plugins both declaring `auth: { provider: "openai" }` can shadow each
 * other (opencode's own `auth login` menu keys off the *first* plugin that
 * claims a provider id), so instead this module only *reads* the credential
 * opencode's built-in "Sign in with ChatGPT" flow already stores in its own
 * `auth.json`, refreshes it with the same token endpoint opencode's Codex
 * OAuth plugin uses when it's expired, and writes the refreshed token back
 * through the SDK client (`client.auth.set`) so opencode and this plugin
 * never race over the same rotating refresh token.
 *
 * Credential resolution order:
 *   1. OPENAI_API_KEY env var (explicit override; platform key, billed per image)
 *   2. opencode's own `openai` auth entry, as set by `opencode auth login`:
 *      - type "api"   -> reuse that platform key directly, no extra setup
 *      - type "oauth" -> the user's ChatGPT/Codex subscription (no per-image
 *        API billing); refreshed here if expired
 *   3. Legacy key file (OPENCODE_OPENAI_KEY_FILE, default
 *      ~/.config/opencode/openai.key) for headless/CI setups that don't want
 *      to go through opencode's managed auth store at all
 */

const OPENAI_PROVIDER_ID = "openai"
// Same OAuth client + token endpoint opencode's built-in Codex/ChatGPT auth
// plugin uses (packages/opencode/src/plugin/openai/codex.ts). Reusing it lets
// us refresh opencode's own stored token instead of inventing a parallel
// OAuth app registration.
const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
const OAUTH_ISSUER = "https://auth.openai.com"

export type ApiCredential = { mode: "api"; key: string }
export type OAuthCredential = { mode: "oauth"; access: string; accountId?: string }
export type OpenAICredential = ApiCredential | OAuthCredential

type StoredOAuth = {
  type: "oauth"
  access: string
  refresh: string
  expires: number
  accountId?: string
}
type StoredApi = { type: "api"; key: string }
type StoredAuthEntry = StoredOAuth | StoredApi | { type: string; [k: string]: unknown }

/**
 * Path to opencode's global auth.json, mirroring opencode's own resolution
 * (packages/core/src/global.ts): $XDG_DATA_HOME/opencode/auth.json, falling
 * back to ~/.local/share/opencode/auth.json.
 */
function opencodeAuthFile(): string {
  const xdgData =
    process.env["XDG_DATA_HOME"]?.trim() || path.join(os.homedir(), ".local", "share")
  return path.join(xdgData, "opencode", "auth.json")
}

function readStoredAuth(providerId: string): StoredAuthEntry | undefined {
  // Mirrors opencode's own Auth.all(): OPENCODE_AUTH_CONTENT (used in tests /
  // sandboxed setups) takes priority over the auth.json file on disk.
  const inline = process.env["OPENCODE_AUTH_CONTENT"]
  if (inline) {
    try {
      const data = JSON.parse(inline) as Record<string, StoredAuthEntry>
      if (data[providerId]) return data[providerId]
    } catch {
      // fall through to the file
    }
  }

  try {
    const raw = readFileSync(opencodeAuthFile(), "utf8")
    const data = JSON.parse(raw) as Record<string, StoredAuthEntry>
    return data[providerId]
  } catch {
    return undefined
  }
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
}

async function refreshOAuth(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(`${OAUTH_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID,
    }),
  })
  if (!res.ok) {
    throw new Error(
      `Failed to refresh your ChatGPT/Codex session (${res.status}). Run "opencode auth login" and reconnect OpenAI.`,
    )
  }
  return (await res.json()) as TokenResponse
}

function keyFilePath(): string {
  return (
    process.env["OPENCODE_OPENAI_KEY_FILE"]?.trim() ||
    path.join(os.homedir(), ".config", "opencode", "openai.key")
  )
}

export async function resolveCredential(
  client: PluginInput["client"],
): Promise<OpenAICredential> {
  const fromEnv = process.env["OPENAI_API_KEY"]?.trim()
  if (fromEnv) return { mode: "api", key: fromEnv }

  const stored = readStoredAuth(OPENAI_PROVIDER_ID)

  if (stored?.type === "api") {
    const key = (stored as StoredApi).key?.trim()
    if (key) return { mode: "api", key }
  }

  if (stored?.type === "oauth") {
    const oauth = stored as StoredOAuth
    let access = oauth.access
    let accountId = oauth.accountId

    // Refresh a little ahead of expiry so a slow request doesn't race it.
    if (!access || oauth.expires < Date.now() + 60_000) {
      if (!oauth.refresh) {
        throw new Error(
          "Your ChatGPT/Codex session has expired and has no refresh token. Run \"opencode auth login\" and reconnect OpenAI.",
        )
      }
      const tokens = await refreshOAuth(oauth.refresh)
      access = tokens.access_token
      const refreshed: StoredOAuth = {
        type: "oauth",
        access,
        refresh: tokens.refresh_token ?? oauth.refresh,
        expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        ...(accountId ? { accountId } : {}),
      }
      // Persist back through opencode so its own auth.json (and any other
      // consumer of the same credential) sees the refreshed token too.
      await client.auth.set({
        path: { id: OPENAI_PROVIDER_ID },
        body: refreshed,
      })
      access = refreshed.access
    }

    return { mode: "oauth", access, accountId }
  }

  const keyFile = keyFilePath()
  try {
    const fromFile = readFileSync(keyFile, "utf8").trim()
    if (fromFile) return { mode: "api", key: fromFile }
  } catch {
    // file missing / unreadable -> fall through to error
  }

  throw new Error(
    "No OpenAI credential found. Any of:\n" +
      "  - Set the OPENAI_API_KEY environment variable (platform key, billed per image)\n" +
      "  - Run \"opencode auth login\", pick OpenAI, and connect ChatGPT Pro/Plus (uses your subscription, no per-image billing) or enter a platform API key\n" +
      `  - Write a platform API key into ${keyFile}\n`,
  )
}
