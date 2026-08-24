import { tool } from "@opencode-ai/plugin"
import type { PluginInput } from "@opencode-ai/plugin"
import path from "path"
import {
  CHATGPT_IMAGE_EDIT_ENDPOINT,
  CHATGPT_IMAGE_ENDPOINT,
  DEFAULT_MODEL,
  OPENAI_IMAGE_EDIT_ENDPOINT,
  OPENAI_IMAGE_ENDPOINT,
  authHeaders,
  requestImages,
  saveImages,
  toDataUrl,
} from "./openai-image"
import { resolveCredential } from "./opencode-auth"

/**
 * image_generate
 *
 * Generate images from a text prompt and save them to disk in the session
 * directory. Uses OpenAI's Images API (default gpt-image-2).
 *
 * Auth: OPENAI_API_KEY / ~/.config/opencode/openai.key (platform key, billed
 * per image), or automatically the ChatGPT/Codex subscription already
 * connected via `opencode auth login` (no per-image billing). See
 * ./opencode-auth for the full resolution order.
 */

const SIZES = ["auto", "1024x1024", "1536x1024", "1024x1536"] as const
const QUALITIES = ["auto", "low", "medium", "high"] as const
const BACKGROUNDS = ["auto", "transparent", "opaque"] as const
const FORMATS = ["png", "jpeg", "webp"] as const

export function createImageGenerate(client: PluginInput["client"]) {
  return tool({
    description:
      "Generate one or more images from a text prompt using OpenAI's image model (default gpt-image-2) and save them to disk. Optionally provide existing reference image(s) to guide/condition the generation. Returns the saved file path(s). Uses an OpenAI platform API key if OPENAI_API_KEY (or ~/.config/opencode/openai.key) is set, otherwise falls back to the ChatGPT/Codex subscription already connected via `opencode auth login`.",
    args: {
      prompt: tool.schema
        .string()
        .min(1)
        .describe("Text description of the image to generate."),
      image_paths: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe(
          "Optional path(s) to existing reference image file(s) (png/jpg/webp) to guide the generation. When provided, the model conditions the new image on these inputs. Relative paths resolve against the session directory.",
        ),
      size: tool.schema
        .enum(SIZES)
        .optional()
        .describe("Image dimensions. Default 'auto'."),
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
        .describe("How many images to generate. Default 1."),
      output_path: tool.schema
        .string()
        .optional()
        .describe(
          "Where to save. A directory, or a file path (used as a base name when n>1). Relative paths resolve against the session directory. Defaults to the session directory.",
        ),
      model: tool.schema
        .string()
        .optional()
        .describe(
          "Image model id. Defaults to OPENCODE_IMAGE_MODEL or 'gpt-image-2'. Use 'gpt-image-1-mini' for cheaper/lower-quality output.",
        ),
    },
    async execute(args, context) {
      const credential = await resolveCredential(client)
      const baseDir = context.directory || process.cwd()
      const model =
        args.model || process.env["OPENCODE_IMAGE_MODEL"] || DEFAULT_MODEL
      const format = args.output_format || "png"
      const n = args.n ?? 1
      const hasRefs = !!args.image_paths && args.image_paths.length > 0

      if (credential.mode === "oauth" && hasRefs && format !== "png") {
        throw new Error(
          "Reference-image generation via the ChatGPT subscription currently returns PNG only. Omit output_format (or set it to 'png'), or set OPENAI_API_KEY to use the platform API for other formats.",
        )
      }

      const resolve = (p: string) =>
        path.isAbsolute(p) ? p : path.join(baseDir, p)

      let data
      if (hasRefs) {
        // Reference images provided: condition the generated image on them.
        if (credential.mode === "oauth") {
          const images = await Promise.all(
            args.image_paths!.map(async (p) => {
              const abs = resolve(p)
              if (!(await Bun.file(abs).exists())) {
                throw new Error(`Reference image not found: ${abs}`)
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
          // Platform API key: multipart via the edits endpoint.
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
              throw new Error(`Reference image not found: ${abs}`)
            }
            form.append("image[]", file, path.basename(abs))
          }

          data = await requestImages(OPENAI_IMAGE_EDIT_ENDPOINT, authHeaders(credential), {
            method: "POST",
            body: form,
          })
        }
      } else {
        const body: Record<string, unknown> = {
          model,
          prompt: args.prompt,
          n,
          size: args.size || "auto",
          quality: args.quality || "auto",
          output_format: format,
        }
        if (args.background) body["background"] = args.background

        data = await requestImages(
          credential.mode === "oauth" ? CHATGPT_IMAGE_ENDPOINT : OPENAI_IMAGE_ENDPOINT,
          authHeaders(credential),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        )
      }

      const saved = await saveImages(data, format, baseDir, args.output_path)

      return [
        `Generated ${saved.length} image(s) with ${model} via ${
          credential.mode === "oauth" ? "your ChatGPT subscription" : "the OpenAI API"
        } (${args.size || "auto"}, ${args.quality || "auto"} quality)${
          hasRefs ? ` from ${args.image_paths!.length} reference image(s)` : ""
        }.`,
        ...saved.map((p) => `  - ${p}`),
      ].join("\n")
    },
  })
}
