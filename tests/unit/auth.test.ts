import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const XDG = mkdtempSync(path.join(os.tmpdir(), "auth-xdg-"))
const AUTH_FILE = path.join(XDG, "opencode", "auth.json")
mkdirSync(path.dirname(AUTH_FILE), { recursive: true })

// Capture so this file's env edits don't leak into other test files sharing the bun test
// process — tests/e2e.test.ts spawns opencode with ...process.env.
const ORIGINAL_XDG_DATA_HOME = process.env.XDG_DATA_HOME
const ORIGINAL_AUTH_CONTENT = process.env.OPENCODE_AUTH_CONTENT
async function loadOpenAIAuth() {
  // Isolate xdg-basedir's import-time environment from other plugin tests.
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      'import { loadOpenAIAuth } from "./src/auth"; console.log(JSON.stringify(await loadOpenAIAuth() ?? null))',
    ],
    {
      cwd: path.resolve(import.meta.dir, "../.."),
      env: { ...process.env, XDG_DATA_HOME: XDG },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const output = await new Response(child.stdout).text()
  expect(await child.exited).toBe(0)
  return JSON.parse(output) ?? undefined
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

afterAll(() => {
  restoreEnv("XDG_DATA_HOME", ORIGINAL_XDG_DATA_HOME)
  restoreEnv("OPENCODE_AUTH_CONTENT", ORIGINAL_AUTH_CONTENT)
  rmSync(XDG, { recursive: true, force: true })
})

function writeAuthFile(content: string): void {
  writeFileSync(AUTH_FILE, content)
}

beforeEach(() => {
  delete process.env.OPENCODE_AUTH_CONTENT
  // Start each test from a no-credentials baseline; tests opt in to a file.
  writeAuthFile("{}")
})

afterEach(() => {
  delete process.env.OPENCODE_AUTH_CONTENT
})

describe("loadOpenAIAuth", () => {
  test("reads a valid oauth entry from OPENCODE_AUTH_CONTENT", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
      openai: { type: "oauth", access: "tok-env", accountId: "acct-1" },
    })
    expect(await loadOpenAIAuth()).toEqual({ type: "oauth", access: "tok-env", accountId: "acct-1" })
  })

  test("prefers OPENCODE_AUTH_CONTENT over the auth.json file", async () => {
    writeAuthFile(JSON.stringify({ openai: { type: "oauth", access: "tok-file" } }))
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: { type: "oauth", access: "tok-env" } })
    expect(await loadOpenAIAuth()).toEqual({ type: "oauth", access: "tok-env" })
  })

  test("falls back to the auth.json file when the env var is unset", async () => {
    writeAuthFile(JSON.stringify({ openai: { type: "oauth", access: "tok-file" } }))
    expect(await loadOpenAIAuth()).toEqual({ type: "oauth", access: "tok-file" })
  })

  test("returns undefined when the entry is not an oauth type", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: { type: "api", access: "tok" } })
    expect(await loadOpenAIAuth()).toBeUndefined()
  })

  test("returns undefined when access is not a string", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ openai: { type: "oauth", access: 123 } })
    expect(await loadOpenAIAuth()).toBeUndefined()
  })

  test("returns undefined when there is no openai entry", async () => {
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ anthropic: { type: "oauth", access: "tok" } })
    expect(await loadOpenAIAuth()).toBeUndefined()
  })

  test("returns undefined when the content is not valid JSON", async () => {
    process.env.OPENCODE_AUTH_CONTENT = "{not json"
    expect(await loadOpenAIAuth()).toBeUndefined()
  })

  test("returns undefined when the auth.json file is missing", async () => {
    rmSync(AUTH_FILE, { force: true })
    // The read rejects; loadOpenAIAuth swallows it and reports no credentials.
    expect(await loadOpenAIAuth()).toBeUndefined()
  })
})
