export type ImageInput = {
  prompt: string
  image_paths?: string[]
  mask_path?: string
  size?: "auto" | "1024x1024" | "1536x1024" | "1024x1536"
  quality?: "auto" | "low" | "medium" | "high"
  background?: "auto" | "transparent" | "opaque"
  output_format?: "png" | "jpeg" | "webp"
  n?: number
  output_path?: string
  model?: string
}

export const input = {
  type: "object" as const,
  properties: {
    prompt: { type: "string", minLength: 1, description: "Image prompt or editing instruction." },
    image_paths: { type: "array", items: { type: "string" }, description: "Input/reference image paths, relative to the session directory." },
    mask_path: { type: "string", description: "PNG mask path (API key mode only)." },
    size: { type: "string", enum: ["auto", "1024x1024", "1536x1024", "1024x1536"] },
    quality: { type: "string", enum: ["auto", "low", "medium", "high"] },
    background: { type: "string", enum: ["auto", "transparent", "opaque"] },
    output_format: { type: "string", enum: ["png", "jpeg", "webp"] },
    n: { type: "integer", minimum: 1, maximum: 10 },
    output_path: { type: "string", description: "Output directory or file path, relative to the session directory." },
    model: { type: "string", description: "Image model ID (default gpt-image-2)." },
  },
  required: ["prompt"],
  additionalProperties: false,
}

export const generateInput = {
  ...input,
  properties: (({ mask_path, ...properties }) => properties)(input.properties),
}
