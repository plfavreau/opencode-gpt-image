import { tool } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"
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

const SIZES = ["auto", "1024x1024", "1536x1024", "1024x1536"] as const
const QUALITIES = ["auto", "low", "medium", "high"] as const
const BACKGROUNDS = ["auto", "transparent", "opaque"] as const
const FORMATS = ["png", "jpeg", "webp"] as const

export function createImageEdit(client: PluginInput["client"]) {
  return tool({
    description:
      "Edit or transform one or more existing images with a text prompt using OpenAI's image model (default gpt-image-2). Supports an optional PNG mask to limit edits to a region (platform API key mode only). Saves results to disk and returns the file path(s). Uses an OpenAI platform API key if OPENAI_API_KEY (or ~/.config/opencode/openai.key) is set, otherwise falls back to the ChatGPT/Codex subscription already connected via `opencode auth login`.",
    args: {
      prompt: tool.schema
        .string()
        .min(1)
        .describe("Instruction describing the desired edit or transformation."),
      image_paths: tool.schema
        .array(tool.schema.string())
        .min(1)
        .describe(
          "Path(s) to input image file(s) (png/jpg/webp). Multiple images are combined/referenced by the model. Relative paths resolve against the session directory.",
        ),
      mask_path: tool.schema
        .string()
        .optional()
        .describe(
          "Optional PNG mask. Transparent areas mark where edits apply; must match the first image's dimensions. Only supported with an OpenAI platform API key (OPENAI_API_KEY). Relative paths resolve against the session directory.",
        ),
      size: tool.schema
        .enum(SIZES)
        .optional()
        .describe("Output dimensions. Default 'auto'."),
      quality: tool.schema
        .enum(QUALITIES)
        .optional()
        .describe("Rendering quality. Higher quality costs more. Default 'auto'."),
      background: tool.schema
        .enum(BACKGROUNDS)
        .optional()
        .describe(
          "Background. 'transparent' requires output_format png or webp. Default 'auto'.",
        ),
      output_format: tool.schema
        .enum(FORMATS)
        .optional()
        .describe("File format of the saved image. Default 'png'."),
      n: tool.schema
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("How many output images to generate. Default 1."),
      output_path: tool.schema
        .string()
        .optional()
        .describe(
          "Where to save. A directory, or a file path (used as a base name when n>1). Relative paths resolve against the session directory. Defaults to the session directory.",
        ),
      model: tool.schema
        .string()
        .optional()
        .describe("Image model id. Defaults to OPENCODE_IMAGE_MODEL or 'gpt-image-2'."),
    },
    async execute(args, context) {
      const credential = await resolveCredential(client)
      const baseDir = context.directory || process.cwd()
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
          args.image_paths.map(async (p) => {
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
        })
      } else {
        const form = new FormData()
        form.append("model", model)
        form.append("prompt", args.prompt)
        form.append("n", String(n))
        form.append("size", args.size || "auto")
        form.append("quality", args.quality || "auto")
        form.append("output_format", format)
        if (args.background) form.append("background", args.background)

        for (const p of args.image_paths) {
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
        })
      }

      const saved = await saveImages(data, format, baseDir, args.output_path)

      return [
        `Edited image(s) with ${model} via ${
          credential.mode === "oauth" ? "your ChatGPT subscription" : "the OpenAI API"
        } from ${args.image_paths.length} input(s)${args.mask_path ? " + mask" : ""}. Saved ${saved.length}:`,
        ...saved.map((p) => `  - ${p}`),
      ].join("\n")
    },
  })
}
