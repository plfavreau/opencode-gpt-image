import path from "path"
import type { OpenAICredential } from "./opencode-auth"

/**
 * Shared helpers for the OpenAI image tools (image_generate, image_edit).
 *
 * Two credential modes, resolved by ./opencode-auth:
 *   - "api":   a Platform API key (https://platform.openai.com/api-keys), billed
 *              per image. Talks to api.openai.com/v1/images/*.
 *   - "oauth": the user's ChatGPT/Codex subscription, reusing whatever
 *              credential opencode itself manages for `opencode auth login`.
 *              Talks to the same undocumented chatgpt.com/backend-api/codex
 *              image endpoints Codex CLI uses -- no per-image API billing,
 *              but best-effort: this surface is not publicly documented and
 *              can change without notice.
 *
 * gpt-image-2 is the default: it is the newest/best image model and is priced
 * the same on input and slightly cheaper on output than gpt-image-1.5, so there
 * is no reason to use an older 1.x model. Override per-call with the `model`
 * arg, or globally with the OPENCODE_IMAGE_MODEL env var (e.g. gpt-image-1-mini
 * for ~4x cheaper, lower-quality output).
 */
export const DEFAULT_MODEL = "gpt-image-2"

export const OPENAI_IMAGE_ENDPOINT = "https://api.openai.com/v1/images/generations"
export const OPENAI_IMAGE_EDIT_ENDPOINT = "https://api.openai.com/v1/images/edits"
// Undocumented, reused from Codex CLI / opencode's own Codex OAuth plugin.
// No compatibility guarantee -- see README for details.
export const CHATGPT_IMAGE_ENDPOINT =
  "https://chatgpt.com/backend-api/codex/images/generations"
export const CHATGPT_IMAGE_EDIT_ENDPOINT =
  "https://chatgpt.com/backend-api/codex/images/edits"

/** Auth headers for either credential mode. */
export function authHeaders(credential: OpenAICredential): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credential.mode === "oauth" ? credential.access : credential.key}`,
  }
  if (credential.mode === "oauth" && credential.accountId) {
    headers["ChatGPT-Account-Id"] = credential.accountId
  }
  return headers
}

export type ImageData = { b64_json?: string; url?: string }

/** POST to an OpenAI/ChatGPT images endpoint and return the data array (throws on error). */
export async function requestImages(
  url: string,
  headers: Record<string, string>,
  init: RequestInit,
): Promise<ImageData[]> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...((init.headers as Record<string, string>) || {}),
    },
  })

  if (!res.ok) {
    const text = await res.text()
    let message = text
    try {
      message = (JSON.parse(text) as any)?.error?.message ?? text
    } catch {
      // keep raw text
    }
    throw new Error(`Image request failed (${res.status} ${res.statusText}): ${message}`)
  }

  const json = (await res.json()) as { data?: ImageData[] }
  const data = json.data ?? []
  if (data.length === 0) throw new Error("No image data returned.")
  return data
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
}

/** Read a local image file and encode it as a data: URL, for the OAuth (ChatGPT) JSON APIs. */
export async function toDataUrl(absPath: string): Promise<string> {
  const mime = MIME_BY_EXT[path.extname(absPath).toLowerCase()] || "image/png"
  const bytes = await Bun.file(absPath).arrayBuffer()
  const b64 = Buffer.from(bytes).toString("base64")
  return `data:${mime};base64,${b64}`
}

/**
 * Save base64 image payloads to disk.
 * - baseDir: session directory (relative output paths resolve against it)
 * - rawOut: optional directory, or a file path used as the base name
 */
export async function saveImages(
  data: ImageData[],
  format: string,
  baseDir: string,
  rawOut?: string,
): Promise<string[]> {
  let targetDir = baseDir
  let baseName = `image-${Date.now()}`

  const out = rawOut?.trim()
  if (out) {
    const resolved = path.isAbsolute(out) ? out : path.join(baseDir, out)
    if (path.extname(resolved) !== "") {
      targetDir = path.dirname(resolved)
      baseName = path.basename(resolved, path.extname(resolved))
    } else {
      targetDir = resolved
    }
  }

  const saved: string[] = []
  for (let i = 0; i < data.length; i++) {
    const b64 = data[i]?.b64_json
    if (!b64) continue
    const suffix = data.length > 1 ? `-${i + 1}` : ""
    const filePath = path.join(targetDir, `${baseName}${suffix}.${format}`)
    await Bun.write(filePath, Buffer.from(b64, "base64"))
    saved.push(filePath)
  }

  if (saved.length === 0) {
    throw new Error("OpenAI response contained no base64 image payloads to save.")
  }
  return saved
}
