import type { Plugin } from "@opencode-ai/plugin"
import { createImageGenerate } from "./image_generate"
import { createImageEdit } from "./image_edit"

/**
 * opencode-gpt-image
 *
 * Registers two tools with opencode:
 *   - image_generate: text -> image(s)
 *   - image_edit:      image(s) (+ optional mask) -> edited image(s)
 *
 * Backed by OpenAI's Images API (default model gpt-image-2). Uses, in order:
 *   1. OPENAI_API_KEY / ~/.config/opencode/openai.key (platform key, billed per image)
 *   2. The ChatGPT/Codex subscription already connected via `opencode auth login`
 * See src/opencode-auth.ts for the full resolution order.
 */
const GptImagePlugin: Plugin = async ({ client }) => {
  return {
    tool: {
      image_generate: createImageGenerate(client),
      image_edit: createImageEdit(client),
    },
  }
}

export default GptImagePlugin
