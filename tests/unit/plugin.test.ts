import { afterEach, describe, expect, mock, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type { Credential, Plugin } from "@opencode/plugin"
import plugin from "../../src/index"
import { IMAGE_ACTIONS, IMAGE_MODELS, INPUT_FIDELITIES, TOOL_DESCRIPTION, TOOL_INPUT_SCHEMA } from "../../src/tool-spec"
import { PNG_BASE64, PNG_BUFFER } from "./fixtures"

type Tool = Awaited<ReturnType<Plugin.Context["tool"]["list"]>>[number]
type ExecuteContext = Parameters<Tool["execute"]>[1]
type Connection = Plugin.Context["integration"]["connection"]

const active = { type: "credential", id: "cred_fixture", label: "ChatGPT", method: "oauth" } as const
function oauth(access = "current-token", accountID: unknown = "account-1"): Credential.Value {
  return {
    type: "oauth",
    methodID: "chatgpt-headless" as Credential.OAuth["methodID"],
    access,
    refresh: "host-owned-refresh-token",
    expires: Date.now() + 3600000,
    metadata: { accountID },
  } as Credential.Value
}

function connection(value: Credential.Value | undefined = oauth()): {
  -readonly [K in keyof Connection]: Connection[K]
} {
  return {
    active: mock(async () => active as Awaited<ReturnType<Connection["active"]>>),
    resolve: mock(async () => value),
  }
}

const dirs: string[] = []
async function tempDir() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "v2-imagegen-"))
  dirs.push(directory)
  return directory
}

async function registerV2Tool(directory: string, auth = connection()) {
  const registered: Tool[] = []
  const sessionGet = mock(async () => ({ location: { directory } }))
  await plugin.setup({
    location: { directory: "/wrong-plugin-load-directory" },
    integration: { connection: auth },
    session: { get: sessionGet },
    tool: {
      transform: async (register: Parameters<Plugin.Context["tool"]["transform"]>[0]) => {
        register({ add: (tool: Tool) => registered.push(tool) } as unknown as Parameters<typeof register>[0])
      },
    },
  } as unknown as Plugin.Context)
  expect(registered).toHaveLength(1)
  return { tool: registered[0], sessionGet }
}

function context(signal?: AbortSignal): ExecuteContext {
  return { sessionID: "ses_fixture", signal } as ExecuteContext
}
const args = { prompt: "a cat", out: "nested/cat.png", quality: "low" }
const originalFetch = globalThis.fetch
const originalAuthContent = process.env.OPENCODE_AUTH_CONTENT

afterEach(async () => {
  globalThis.fetch = originalFetch
  if (originalAuthContent === undefined) delete process.env.OPENCODE_AUTH_CONTENT
  else process.env.OPENCODE_AUTH_CONTENT = originalAuthContent
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function stubFetch() {
  const fetchMock = mock(
    async (_url: string, _init: RequestInit) =>
      new Response(
        `data: ${JSON.stringify({ type: "response.output_item.done", item: { type: "image_generation_call", result: PNG_BASE64 } })}\n\n`,
      ),
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

// Like stubFetch, but the image item also carries the descriptive fields a backend may report.
function stubFetchReporting(reported: Record<string, unknown>) {
  const fetchMock = mock(
    async (_url: string, _init: RequestInit) =>
      new Response(
        `data: ${JSON.stringify({
          type: "response.output_item.done",
          item: { type: "image_generation_call", result: PNG_BASE64, ...reported },
        })}\n\n`,
      ),
  )
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe("plugin entrypoints", () => {
  test("exports both APIs and preserves the v1 tool schema", async () => {
    expect(plugin.id).toBe("opencode-gpt-imagegen")
    const hooks = await plugin.server({} as never)
    expect(hooks.tool?.gpt_imagegen.description).toBe(TOOL_DESCRIPTION)
    expect(Object.keys(hooks.tool?.gpt_imagegen.args ?? {})).toEqual(Object.keys(TOOL_INPUT_SCHEMA.properties))
    const { tool } = await registerV2Tool(await tempDir())
    expect(tool.name).toBe("gpt_imagegen")
    expect(tool.input).toEqual(TOOL_INPUT_SCHEMA)
  })

  test("v1 retains legacy auth and forwards cancellation", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: { type: "oauth", access: "legacy" } })
    const fetchMock = stubFetch()
    const hooks = await plugin.server({} as never)
    const controller = new AbortController()
    const result = await hooks.tool?.gpt_imagegen.execute(args, {
      directory: await tempDir(),
      abort: controller.signal,
    } as never)
    expect(result).toHaveProperty("metadata.billing", "subscription")
    expect(fetchMock.mock.calls[0][1].headers).toHaveProperty("Authorization", "Bearer legacy")
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })
})

describe("gpt_imagegen v2", () => {
  test("uses the session directory for references and versioned output", async () => {
    const dir = await tempDir()
    await writeFile(path.join(dir, "reference.png"), PNG_BUFFER)
    const fetchMock = stubFetch()
    const { tool, sessionGet } = await registerV2Tool(dir)
    const input = { ...args, images: ["reference.png"] }
    const first = await tool.execute(input, context())
    const second = await tool.execute(input, context())
    expect(sessionGet).toHaveBeenCalledWith({ sessionID: "ses_fixture" })
    expect(first.metadata).toEqual({ out: path.join(dir, args.out), versioned: false, billing: "subscription" })
    expect(second.metadata?.versioned).toBe(true)
    expect(await readFile(path.join(dir, args.out))).toEqual(PNG_BUFFER)
    expect(await readFile(second.metadata?.out)).toEqual(PNG_BUFFER)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.input[0].content[1].image_url).toBe(`data:image/png;base64,${PNG_BASE64}`)
  })

  test("resolves the active account on every invocation and forwards only its access token and account ID", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: { type: "oauth", access: "stale-legacy" } })
    const auth = connection()
    const fetchMock = stubFetch()
    const { tool } = await registerV2Tool(await tempDir(), auth)
    await tool.execute(args, context())
    expect(auth.active).toHaveBeenCalledWith("openai")
    expect(auth.resolve).toHaveBeenCalledWith(active)
    expect(fetchMock.mock.calls[0][1].headers).toHaveProperty("Authorization", "Bearer current-token")
    expect(fetchMock.mock.calls[0][1].headers).toHaveProperty("ChatGPT-Account-Id", "account-1")
    auth.resolve = mock(async () => oauth("refreshed-token", "account-2"))
    const result = await tool.execute(args, context())
    expect(fetchMock.mock.calls[1][1].headers).toHaveProperty("Authorization", "Bearer refreshed-token")
    expect(fetchMock.mock.calls[1][1].headers).toHaveProperty("ChatGPT-Account-Id", "account-2")
    expect(JSON.stringify(result)).not.toContain("token")
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("host-owned-refresh-token")
  })

  test.each(["chatgpt-browser", "chatgpt-headless"])("accepts %s credentials", async (methodID) => {
    const fetchMock = stubFetch()
    const { tool } = await registerV2Tool(await tempDir(), connection({ ...oauth(), methodID } as Credential.Value))
    await tool.execute(args, context())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test.each([undefined, 123, ""])("omits an invalid or absent account ID (%s)", async (accountID) => {
    const fetchMock = stubFetch()
    const value = { ...oauth(), metadata: { accountID } } as Credential.Value
    const { tool } = await registerV2Tool(await tempDir(), connection(value))
    await tool.execute(args, context())
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("ChatGPT-Account-Id")
  })

  test.each([
    undefined,
    { type: "key", key: "api-key" },
    { ...oauth(), methodID: "unrelated-oauth" },
    { ...oauth(), access: "" },
    { ...oauth(), expires: 0 },
  ])("rejects unusable resolved credentials without legacy fallback", async (value) => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: { type: "oauth", access: "stale-legacy" } })
    const auth = connection()
    auth.resolve = mock(async () => value as Credential.Value | undefined)
    const fetchMock = stubFetch()
    const { tool } = await registerV2Tool(await tempDir(), auth)
    await expect(tool.execute(args, context())).rejects.toThrow("OAuth credentials not configured")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("does not resolve a missing connection or fall back to legacy credentials", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: { type: "oauth", access: "stale-legacy" } })
    const auth = connection()
    auth.active = mock(async () => undefined)
    const fetchMock = stubFetch()
    const { tool } = await registerV2Tool(await tempDir(), auth)
    await expect(tool.execute(args, context())).rejects.toThrow("OAuth credentials not configured")
    expect(auth.resolve).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("propagates credential resolution failures without using stale credentials", async () => {
    const auth = connection()
    auth.resolve = mock(async () => {
      throw new Error("refresh failed")
    })
    const fetchMock = stubFetch()
    const { tool } = await registerV2Tool(await tempDir(), auth)
    await expect(tool.execute(args, context())).rejects.toThrow("refresh failed")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("forwards the host cancellation signal", async () => {
    const fetchMock = stubFetch()
    const controller = new AbortController()
    const { tool } = await registerV2Tool(await tempDir())
    await tool.execute(args, context(controller.signal))
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })

  test("does not start generation when already cancelled", async () => {
    const auth = connection()
    const fetchMock = stubFetch()
    const { tool } = await registerV2Tool(await tempDir(), auth)
    await expect(tool.execute(args, context(AbortSignal.abort()))).rejects.toThrow()
    expect(auth.active).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("image model argument", () => {
  test("both schemas offer the same image models and reject an unknown value", async () => {
    const hooks = await plugin.server({} as never)
    // The registered arg is typed as the abstract zod base; narrow it to reach safeParse.
    const zodModel = hooks.tool?.gpt_imagegen.args.model as unknown as {
      safeParse: (value: unknown) => { success: boolean }
    }
    expect(TOOL_INPUT_SCHEMA.properties.model.enum).toEqual(IMAGE_MODELS)
    expect(TOOL_INPUT_SCHEMA.additionalProperties).toBe(false)

    for (const model of IMAGE_MODELS) {
      expect(zodModel.safeParse(model).success).toBe(true)
    }
    // An unknown or stale model must be refused before a request is made.
    expect(zodModel.safeParse("gpt-image-9-ultra").success).toBe(false)
    expect(zodModel.safeParse("gpt-5.5").success).toBe(false)
    // The argument stays optional so existing callers keep working.
    expect(zodModel.safeParse(undefined).success).toBe(true)
    expect(TOOL_INPUT_SCHEMA.required).not.toContain("model")
  })

  test("v2 reports the requested model and the backend's reported fields in metadata", async () => {
    const fetchMock = stubFetchReporting({
      revised_prompt: "a fluffy cat",
      size: "1024x1536",
      quality: "high",
      model: "gpt-image-2.5-sunburst",
    })
    const { tool } = await registerV2Tool(await tempDir())
    const result = await tool.execute({ ...args, model: "gpt-image-2.5-sunburst" }, context())

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.tools[0].model).toBe("gpt-image-2.5-sunburst")
    expect(result.metadata).toMatchObject({
      imageModel: "gpt-image-2.5-sunburst",
      reportedImageModel: "gpt-image-2.5-sunburst",
      reportedSize: "1024x1536",
      reportedQuality: "high",
      revisedPrompt: "a fluffy cat",
    })
  })

  test("v1 reports the requested model in metadata", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: { type: "oauth", access: "legacy" } })
    const fetchMock = stubFetchReporting({ model: "gpt-image-2.5-flare" })
    const hooks = await plugin.server({} as never)
    const result = await hooks.tool?.gpt_imagegen.execute({ ...args, model: "gpt-image-2.5-flare" }, {
      directory: await tempDir(),
    } as never)

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).tools[0].model).toBe("gpt-image-2.5-flare")
    expect(result as { metadata: Record<string, unknown> }).toHaveProperty("metadata")
    expect((result as { metadata: Record<string, unknown> }).metadata).toMatchObject({
      imageModel: "gpt-image-2.5-flare",
      reportedImageModel: "gpt-image-2.5-flare",
    })
  })

  test("omits the model metadata when no model is requested and none is reported", async () => {
    const fetchMock = stubFetch()
    const { tool } = await registerV2Tool(await tempDir())
    const result = await tool.execute(args, context())

    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).tools[0]).not.toHaveProperty("model")
    expect(result.metadata).toEqual({
      out: expect.any(String),
      versioned: false,
      billing: "subscription",
    })
  })
})

describe("edit arguments", () => {
  type ZodLike = { safeParse: (value: unknown) => { success: boolean } }

  test("both schemas offer the same optional action and inputFidelity values", async () => {
    const hooks = await plugin.server({} as never)
    const zodArgs = hooks.tool?.gpt_imagegen.args as unknown as Record<string, ZodLike>
    expect(TOOL_INPUT_SCHEMA.properties.action.enum).toEqual(IMAGE_ACTIONS)
    expect(TOOL_INPUT_SCHEMA.properties.inputFidelity.enum).toEqual(INPUT_FIDELITIES)
    expect(TOOL_INPUT_SCHEMA.properties.mask.type).toBe("string")

    for (const action of IMAGE_ACTIONS) expect(zodArgs.action.safeParse(action).success).toBe(true)
    for (const fidelity of INPUT_FIDELITIES) expect(zodArgs.inputFidelity.safeParse(fidelity).success).toBe(true)
    expect(zodArgs.action.safeParse("inpaint").success).toBe(false)
    expect(zodArgs.inputFidelity.safeParse("medium").success).toBe(false)
    for (const key of ["action", "inputFidelity", "mask"]) {
      expect(zodArgs[key].safeParse(undefined).success).toBe(true)
      expect(TOOL_INPUT_SCHEMA.required).not.toContain(key)
    }
  })

  test("v2 reads the mask file and sends it with the edit fields", async () => {
    const dir = await tempDir()
    const mask = Buffer.concat([PNG_BUFFER, Buffer.from("mask")])
    await writeFile(path.join(dir, "preview.png"), PNG_BUFFER)
    await writeFile(path.join(dir, "mask.png"), mask)
    const fetchMock = stubFetch()
    const { tool } = await registerV2Tool(dir)
    await tool.execute(
      { ...args, images: ["preview.png"], action: "edit", inputFidelity: "low", mask: "mask.png" },
      context(),
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.tools[0]).toMatchObject({
      action: "edit",
      input_fidelity: "low",
      input_image_mask: { image_url: `data:image/png;base64,${mask.toString("base64")}` },
    })
    expect(body.input[0].content[1].image_url).toBe(`data:image/png;base64,${PNG_BASE64}`)
  })

  test("v1 sends action edit with the first reference image", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: { type: "oauth", access: "legacy" } })
    const dir = await tempDir()
    await writeFile(path.join(dir, "preview.png"), PNG_BUFFER)
    const fetchMock = stubFetch()
    const hooks = await plugin.server({} as never)
    await hooks.tool?.gpt_imagegen.execute({ ...args, images: ["preview.png"], action: "edit" }, {
      directory: dir,
    } as never)

    const tool = JSON.parse(fetchMock.mock.calls[0][1].body as string).tools[0]
    expect(tool.action).toBe("edit")
    expect(tool).not.toHaveProperty("input_fidelity")
    expect(tool).not.toHaveProperty("input_image_mask")
  })

  test.each([
    [{ action: "edit" }, "action edit needs the image to edit"],
    [{ action: "edit", images: [] }, "action edit needs the image to edit"],
    [{ mask: "mask.png" }, "mask applies to the first entry of images"],
    [{ mask: "", images: ["preview.png"] }, "mask must be a non-empty file path"],
    [{ action: "inpaint", images: ["preview.png"] }, "action must be one of generate, edit, auto"],
    [{ inputFidelity: "medium" }, "inputFidelity must be one of high, low"],
  ])("refuses %j before any request", async (extra, message) => {
    const dir = await tempDir()
    await writeFile(path.join(dir, "preview.png"), PNG_BUFFER)
    const fetchMock = stubFetch()
    const { tool } = await registerV2Tool(dir)
    await expect(tool.execute({ ...args, ...extra }, context())).rejects.toThrow(message)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("refuses a mask that is not a PNG", async () => {
    const dir = await tempDir()
    await writeFile(path.join(dir, "preview.png"), PNG_BUFFER)
    await writeFile(path.join(dir, "mask.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
    const fetchMock = stubFetch()
    const { tool } = await registerV2Tool(dir)
    await expect(
      tool.execute({ ...args, images: ["preview.png"], action: "edit", mask: "mask.jpg" }, context()),
    ).rejects.toThrow(`mask must be a PNG file: ${path.join(dir, "mask.jpg")}`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test("an edit without a mask sends no input_image_mask", async () => {
    const dir = await tempDir()
    await writeFile(path.join(dir, "preview.png"), PNG_BUFFER)
    const fetchMock = stubFetch()
    const { tool } = await registerV2Tool(dir)
    await tool.execute({ ...args, images: ["preview.png"], action: "edit" }, context())
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).tools[0]).not.toHaveProperty("input_image_mask")
  })
})
