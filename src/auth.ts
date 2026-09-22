import * as fs from "node:fs/promises"
import * as path from "node:path"
import type { Plugin } from "@opencode/plugin"
import { xdgData } from "xdg-basedir"
import type { OpenAIAuth } from "./types"

export async function loadV2OpenAIAuth(
  connection: Plugin.Context["integration"]["connection"],
): Promise<OpenAIAuth | undefined> {
  const active = await connection.active("openai")
  if (!active) return undefined

  // OpenCode owns credential selection, refresh, and persistence in v2.
  const value = await connection.resolve(active)
  if (
    value?.type !== "oauth" ||
    (value.methodID !== "chatgpt-browser" && value.methodID !== "chatgpt-headless") ||
    !value.access ||
    value.expires <= Date.now()
  ) {
    return undefined
  }
  const accountId = value.metadata?.accountID
  return {
    type: "oauth",
    access: value.access,
    ...(typeof accountId === "string" && accountId ? { accountId } : {}),
  }
}

// OpenCode v1 does not expose auth reads to plugins; its environment override takes precedence over auth.json.
async function loadAuthData(): Promise<Record<string, unknown>> {
  if (process.env.OPENCODE_AUTH_CONTENT) {
    return JSON.parse(process.env.OPENCODE_AUTH_CONTENT) as Record<string, unknown>
  }
  if (!xdgData) {
    throw new Error("could not determine XDG data directory")
  }
  const raw = await fs.readFile(path.join(xdgData, "opencode", "auth.json"), "utf-8")
  return JSON.parse(raw) as Record<string, unknown>
}

export async function loadOpenAIAuth(): Promise<OpenAIAuth | undefined> {
  try {
    const data = await loadAuthData()
    const entry = data.openai as Partial<OpenAIAuth> | undefined
    if (entry?.type === "oauth" && typeof entry.access === "string") {
      return entry as OpenAIAuth
    }
  } catch {
    return undefined
  }
  return undefined
}
