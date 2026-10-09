import { afterEach, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import plugin from "../src/index"
import { createImageGenerate } from "../src/image_generate"
import { createImageEdit } from "../src/image_edit"
import { resolveCredential } from "../src/opencode-auth"

const originalFetch = globalThis.fetch
const originalKey = process.env.OPENAI_API_KEY
afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY
  else process.env.OPENAI_API_KEY = originalKey
})

test("registers both tools in V2", async () => {
  const tools: string[] = []
  const ctx = {
    tool: { transform: async (fn: (editor: { add: (tool: { name: string }) => void }) => void) => fn({ add: tool => tools.push(tool.name) }) },
  }
  await plugin.setup(ctx as never)
  expect(tools).toEqual(["image_generate", "image_edit"])
})

test("any agent can generate in its session directory with an API key", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-gpt-image-"))
  try {
    process.env.OPENAI_API_KEY = "test-key"
    globalThis.fetch = (async (_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-key")
      return Response.json({ data: [{ b64_json: Buffer.from("png-data").toString("base64") }] })
    }) as typeof fetch
    const ctx = { session: { get: async () => ({ location: { directory: dir } }) } }
    const tool = createImageGenerate(ctx as never)
    const result = await tool.execute({ prompt: "a robot", output_path: "art/robot.png" }, {
      sessionID: "test-session", signal: new AbortController().signal,
    })
    expect(result.content).toContain("art/robot.png")
    expect(await readFile(path.join(dir, "art", "robot.png"), "utf8")).toBe("png-data")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("uses the active OpenAI connection without reading V1 auth.json", async () => {
  delete process.env.OPENAI_API_KEY
  const ctx = { integration: { connection: {
    active: async () => ({ id: "openai-test" }),
    resolve: async () => ({ type: "oauth", access: "access-token", expires: Date.now() + 100_000, metadata: { accountId: "account-1" } }),
  } } }
  expect(await resolveCredential(ctx as never)).toEqual({ mode: "oauth", access: "access-token", accountId: "account-1" })
})

test("edits an existing image in the session directory", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-gpt-image-"))
  try {
    process.env.OPENAI_API_KEY = "test-key"
    await writeFile(path.join(dir, "input.png"), "source")
    globalThis.fetch = (async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/images/edits")
      expect(init?.body).toBeInstanceOf(FormData)
      return Response.json({ data: [{ b64_json: Buffer.from("edited").toString("base64") }] })
    }) as typeof fetch
    const tool = createImageEdit({ session: { get: async () => ({ location: { directory: dir } }) } } as never)
    const result = await tool.execute({ prompt: "make blue", image_paths: ["input.png"], output_path: "edited.png" }, {
      sessionID: "test-session", signal: new AbortController().signal,
    })
    expect(result.content).toContain("edited.png")
    expect(await readFile(path.join(dir, "edited.png"), "utf8")).toBe("edited")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
