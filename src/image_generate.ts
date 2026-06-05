import { tool } from "@opencode-ai/plugin"
import {
  DEFAULT_MODEL,
  requestImages,
  resolveApiKey,
  saveImages,
} from "./openai-image"

/**
 * image_generate
 *
 * Generate images from a text prompt with OpenAI's Images API (default
 * gpt-image-2) and save them to disk in the session directory.
 *
 * Auth: needs a Platform API key via OPENAI_API_KEY or the key file
 * ~/.config/opencode/openai.key (see openai-image.ts). This is NOT the
 * Codex/ChatGPT subscription token.
 */

const SIZES = ["auto", "1024x1024", "1536x1024", "1024x1536"] as const
const QUALITIES = ["auto", "low", "medium", "high"] as const
const BACKGROUNDS = ["auto", "transparent", "opaque"] as const
const FORMATS = ["png", "jpeg", "webp"] as const

export const image_generate = tool({
  description:
    "Generate one or more images from a text prompt using OpenAI's image model (default gpt-image-2) and save them to disk. Returns the saved file path(s). Requires an OpenAI platform API key (OPENAI_API_KEY env var or ~/.config/opencode/openai.key), billed per image; NOT the ChatGPT/Codex subscription.",
  args: {
    prompt: tool.schema
      .string()
      .min(1)
      .describe("Text description of the image to generate."),
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
    const apiKey = resolveApiKey()
    const model =
      args.model || process.env["OPENCODE_IMAGE_MODEL"] || DEFAULT_MODEL
    const format = args.output_format || "png"
    const n = args.n ?? 1

    const body: Record<string, unknown> = {
      model,
      prompt: args.prompt,
      n,
      size: args.size || "auto",
      quality: args.quality || "auto",
      output_format: format,
    }
    if (args.background) body["background"] = args.background

    const data = await requestImages(
      "https://api.openai.com/v1/images/generations",
      apiKey,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    )

    const saved = await saveImages(
      data,
      format,
      context.directory || process.cwd(),
      args.output_path,
    )

    return [
      `Generated ${saved.length} image(s) with ${model} (${args.size || "auto"}, ${args.quality || "auto"} quality).`,
      ...saved.map((p) => `  - ${p}`),
    ].join("\n")
  },
})
