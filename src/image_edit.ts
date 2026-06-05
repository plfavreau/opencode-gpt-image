import { tool } from "@opencode-ai/plugin"
import path from "path"
import {
  DEFAULT_MODEL,
  requestImages,
  resolveApiKey,
  saveImages,
} from "./openai-image"

/**
 * image_edit
 *
 * Edit / transform one or more existing images with a text prompt using
 * OpenAI's Images Edit API (default gpt-image-2). Optionally constrain edits to
 * a masked region. Saves the result(s) to disk in the session directory.
 *
 * Multipart upload: input images (and optional mask) are sent as files.
 * Mask semantics: transparent pixels in the PNG mask mark the area to edit;
 * the mask must match the first input image's dimensions.
 *
 * Auth: needs a Platform API key via OPENAI_API_KEY or ~/.config/opencode/openai.key.
 */

const SIZES = ["auto", "1024x1024", "1536x1024", "1024x1536"] as const
const QUALITIES = ["auto", "low", "medium", "high"] as const
const BACKGROUNDS = ["auto", "transparent", "opaque"] as const
const FORMATS = ["png", "jpeg", "webp"] as const

export const image_edit = tool({
  description:
    "Edit or transform one or more existing images with a text prompt using OpenAI's image model (default gpt-image-2). Supports an optional PNG mask to limit edits to a region. Saves results to disk and returns the file path(s). Requires an OpenAI platform API key (OPENAI_API_KEY env var or ~/.config/opencode/openai.key), billed per image; NOT the ChatGPT/Codex subscription.",
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
        "Optional PNG mask. Transparent areas mark where edits apply; must match the first image's dimensions. Relative paths resolve against the session directory.",
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
      .describe(
        "Image model id. Defaults to OPENCODE_IMAGE_MODEL or 'gpt-image-2'.",
      ),
  },
  async execute(args, context) {
    const apiKey = resolveApiKey()
    const baseDir = context.directory || process.cwd()
    const model =
      args.model || process.env["OPENCODE_IMAGE_MODEL"] || DEFAULT_MODEL
    const format = args.output_format || "png"
    const n = args.n ?? 1

    const resolve = (p: string) =>
      path.isAbsolute(p) ? p : path.join(baseDir, p)

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

    const data = await requestImages(
      "https://api.openai.com/v1/images/edits",
      apiKey,
      { method: "POST", body: form },
    )

    const saved = await saveImages(data, format, baseDir, args.output_path)

    return [
      `Edited image(s) with ${model} from ${args.image_paths.length} input(s)${
        args.mask_path ? " + mask" : ""
      }. Saved ${saved.length}:`,
      ...saved.map((p) => `  - ${p}`),
    ].join("\n")
  },
})
