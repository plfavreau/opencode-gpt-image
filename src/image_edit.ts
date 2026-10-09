import type { Plugin } from "@opencode/plugin"
import { input as sharedInput, type ImageInput } from "./tool-input"
import path from "path"
import {
  CHATGPT_IMAGE_EDIT_ENDPOINT,
  DEFAULT_MODEL,
  OPENAI_IMAGE_EDIT_ENDPOINT,
  authHeaders,
  requestImages,
  saveImages,
  toDataUrl,
} from "./openai-image"
import { resolveCredential } from "./opencode-auth"

/**
 * image_edit
 *
 * Edit / transform one or more existing images with a text prompt using
 * OpenAI's Images Edit API (default gpt-image-2). Optionally constrain edits to
 * a masked region. Saves the result(s) to disk in the session directory.
 *
 * Multipart upload (platform API key mode): input images (and optional mask)
 * are sent as files. Mask semantics: transparent pixels in the PNG mask mark
 * the area to edit; the mask must match the first input image's dimensions.
 * Masks are only supported in platform API key mode; the ChatGPT subscription
 * path has no mask support and only returns PNG.
 *
 * Auth: OPENAI_API_KEY / ~/.config/opencode/openai.key, or automatically the
 * ChatGPT/Codex subscription connected via `opencode auth login`. See
 * ./opencode-auth for the full resolution order.
 */

type Context = Parameters<NonNullable<ReturnType<typeof Plugin.define>["setup"]>>[0]

export function createImageEdit(client: Context) {
  return {
    name: "image_edit",
    description:
      "Edit or transform one or more existing images with a text prompt using OpenAI's image model (default gpt-image-2). Supports an optional PNG mask to limit edits to a region (platform API key mode only). Saves results to disk and returns the file path(s). Uses an OpenAI platform API key if OPENAI_API_KEY (or ~/.config/opencode/openai.key) is set, otherwise falls back to the ChatGPT/Codex subscription already connected via `opencode auth login`.",
    input: { ...sharedInput, required: ["prompt", "image_paths"] },
    async execute(raw: unknown, context: { sessionID: string; signal: AbortSignal }) {
      const args = raw as ImageInput
      const credential = await resolveCredential(client)
      const session = await client.session.get({ sessionID: context.sessionID })
      const baseDir = session.location.directory
      const model =
        args.model || process.env["OPENCODE_IMAGE_MODEL"] || DEFAULT_MODEL
      const format = args.output_format || "png"
      const n = args.n ?? 1

      if (args.mask_path && credential.mode === "oauth") {
        throw new Error(
          "mask_path requires an OpenAI platform API key. Set OPENAI_API_KEY, or omit mask_path to edit via the ChatGPT subscription.",
        )
      }
      if (credential.mode === "oauth" && format !== "png") {
        throw new Error(
          "Image edits via the ChatGPT subscription currently return PNG only. Omit output_format (or set it to 'png'), or set OPENAI_API_KEY to use the platform API for other formats.",
        )
      }

      const resolve = (p: string) =>
        path.isAbsolute(p) ? p : path.join(baseDir, p)

      let data
      if (credential.mode === "oauth") {
        const images = await Promise.all(
          args.image_paths!.map(async (p) => {
            const abs = resolve(p)
            if (!(await Bun.file(abs).exists())) {
              throw new Error(`Input image not found: ${abs}`)
            }
            return { image_url: await toDataUrl(abs) }
          }),
        )
        data = await requestImages(CHATGPT_IMAGE_EDIT_ENDPOINT, authHeaders(credential), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            prompt: args.prompt,
            images,
            n,
            size: args.size || "auto",
            quality: args.quality || "auto",
          }),
        }, context.signal)
      } else {
        const form = new FormData()
        form.append("model", model)
        form.append("prompt", args.prompt)
        form.append("n", String(n))
        form.append("size", args.size || "auto")
        form.append("quality", args.quality || "auto")
        form.append("output_format", format)
        if (args.background) form.append("background", args.background)

        for (const p of args.image_paths!) {
          const abs = resolve(p)
          const file = Bun.file(abs)
          if (!(await file.exists())) {
            throw new Error(`Input image not found: ${abs}`)
          }
          form.append("image[]", file, path.basename(abs))
        }

        if (args.mask_path) {
          const absMask = resolve(args.mask_path)
          const maskFile = Bun.file(absMask)
          if (!(await maskFile.exists())) {
            throw new Error(`Mask not found: ${absMask}`)
          }
          form.append("mask", maskFile, path.basename(absMask))
        }

        data = await requestImages(OPENAI_IMAGE_EDIT_ENDPOINT, authHeaders(credential), {
          method: "POST",
          body: form,
        }, context.signal)
      }

      const saved = await saveImages(data, format, baseDir, args.output_path)

      return { content: [
        `Edited image(s) with ${model} via ${
          credential.mode === "oauth" ? "your ChatGPT subscription" : "the OpenAI API"
        } from ${args.image_paths!.length} input(s)${args.mask_path ? " + mask" : ""}. Saved ${saved.length}:`,
        ...saved.map((p) => `  - ${p}`),
      ].join("\n") }
    },
  }
}
