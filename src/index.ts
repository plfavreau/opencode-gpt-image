import { Plugin } from "@opencode/plugin"
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
export default Plugin.define({
  id: "opencode-gpt-image",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add(createImageGenerate(ctx))
      editor.add(createImageEdit(ctx))
    })
  },
})
