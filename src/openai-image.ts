import { readFileSync } from "fs"
import os from "os"
import path from "path"

/**
 * Shared helpers for the OpenAI image tools (image_generate, image_edit).
 *
 * Auth: a Platform API key is required (https://platform.openai.com/api-keys),
 * billed per image. This is NOT the Codex / "Sign in with ChatGPT" subscription
 * token, which cannot reach the image endpoints.
 *
 * gpt-image-2 is the default: it is the newest/best image model and is priced
 * the same on input and slightly cheaper on output than gpt-image-1.5, so there
 * is no reason to use an older 1.x model. Override per-call with the `model`
 * arg, or globally with the OPENCODE_IMAGE_MODEL env var (e.g. gpt-image-1-mini
 * for ~4x cheaper, lower-quality output).
 */
export const DEFAULT_MODEL = "gpt-image-2"

/**
 * Resolve the OpenAI API key. Order:
 *   1. OPENAI_API_KEY env var
 *   2. A key file: OPENCODE_OPENAI_KEY_FILE, else ~/.config/opencode/openai.key
 * The file fallback means you can store the key once and never set the env var.
 */
export function resolveApiKey(): string {
  const fromEnv = process.env["OPENAI_API_KEY"]?.trim()
  if (fromEnv) return fromEnv

  const keyFile =
    process.env["OPENCODE_OPENAI_KEY_FILE"]?.trim() ||
    path.join(os.homedir(), ".config", "opencode", "openai.key")
  try {
    const fromFile = readFileSync(keyFile, "utf8").trim()
    if (fromFile) return fromFile
  } catch {
    // file missing / unreadable -> fall through to error
  }

  throw new Error(
    `No OpenAI API key found. Either set the OPENAI_API_KEY environment variable, ` +
      `or write the key (and nothing else) into ${keyFile}. ` +
      `Image generation needs a platform API key (https://platform.openai.com/api-keys), ` +
      `billed per image, separate from the Codex/ChatGPT subscription.`,
  )
}

export type ImageData = { b64_json?: string; url?: string }

/** POST to an OpenAI images endpoint and return the data array (throws on error). */
export async function requestImages(
  url: string,
  apiKey: string,
  init: RequestInit,
): Promise<ImageData[]> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
    throw new Error(
      `OpenAI Images API error (${res.status} ${res.statusText}): ${message}`,
    )
  }

  const json = (await res.json()) as { data?: ImageData[] }
  const data = json.data ?? []
  if (data.length === 0) throw new Error("OpenAI returned no image data.")
  return data
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
    throw new Error(
      "OpenAI response contained no base64 image payloads to save.",
    )
  }
  return saved
}
