import type { Plugin } from "@opencode-ai/plugin"
import { image_generate } from "./image_generate"
import { image_edit } from "./image_edit"

/**
 * opencode-gpt-image
 *
 * Registers two tools with opencode:
 *   - image_generate: text -> image(s)
 *   - image_edit:      image(s) (+ optional mask) -> edited image(s)
 *
 * Backed by OpenAI's Images API (default model gpt-image-2). Requires a
 * platform API key via OPENAI_API_KEY or ~/.config/opencode/openai.key.
 */
const GptImagePlugin: Plugin = async () => {
  return {
    tool: {
      image_generate,
      image_edit,
    },
  }
}

export default GptImagePlugin
