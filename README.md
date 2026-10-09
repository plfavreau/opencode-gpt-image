# opencode-gpt-image

Image **generation** and **editing** tools for [opencode](https://opencode.ai), powered by OpenAI `gpt-image-2`.

Add one line to your config and any agent can create and edit images.

![image_generate and image_edit called from an opencode agent, both authenticated via a ChatGPT subscription](.github/assets/demo.png)

## Install

For this V2 branch, clone the repo and run `bun install`, then add the local directory to the `plugins` array in your OpenCode V2 `opencode.json` (global: `~/.config/opencode/opencode.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-gpt-image"]
}
```

The published `opencode-gpt-image@0.3.0` still uses the V1 plugin API; do not configure the npm package until a V2 release is published. Connect OpenAI through `/connect` (see [Auth](#auth) below). Both tools are available regardless of the agent's selected model.

## Auth

The tools are always registered; auth is only resolved when you actually call one, in this order:

1. **`OPENAI_API_KEY`** env var — a [platform API key](https://platform.openai.com/api-keys), billed per image.
2. **OpenCode V2's active `openai` connection**, set via `/connect` — no separate setup:
   - a platform API key you entered there, reused directly, **or**
   - your **ChatGPT/Codex subscription** (Plus/Pro/Business), if you signed in with "Sign in with ChatGPT". Uses the connection's current OAuth access token; reconnect if it has expired. No per-image API billing.
3. **A key file** (`~/.config/opencode/openai.key` by default) — a fallback for headless/CI setups that don't want to touch opencode's managed auth store.
4. Nothing found → the tool call fails with a message telling you exactly what to do.

If OpenAI is not connected yet, either export `OPENAI_API_KEY`, or use OpenCode's `/connect` menu and select OpenAI.

> [!NOTE]
> The ChatGPT/Codex subscription path calls the same undocumented `chatgpt.com/backend-api/codex/images/*` endpoints Codex CLI/opencode use internally. It's not a publicly documented API and can change without notice. `mask_path` and non-PNG output are only available in platform API key mode. Usage must comply with OpenAI's [Terms of Use](https://openai.com/policies/row-terms-of-use/) and [Usage Policies](https://openai.com/policies/usage-policies/).

## Tools

| Tool | Does |
| --- | --- |
| `image_generate` | Text prompt (+ optional reference image(s)) -> image(s), saved to disk. |
| `image_edit` | Edit/transform existing image(s), optional mask, -> image(s). |

`image_generate` also accepts an optional `image_paths` array of existing reference images to guide/condition the generation.

Both support `size`, `quality`, `background`, `output_format`, `n`, and `output_path`.

## Config

| Env var | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | Platform API key (overrides opencode's stored credential and the key file). |
| `OPENCODE_OPENAI_KEY_FILE` | Custom key-file path. Default `~/.config/opencode/openai.key`. |
| `OPENCODE_IMAGE_MODEL` | Override the model. Default `gpt-image-2` (try `gpt-image-1-mini` for cheaper output). |

## License

MIT
