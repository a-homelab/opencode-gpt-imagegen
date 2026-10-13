import type { IMAGE_ACTIONS, IMAGE_MODELS, INPUT_FIDELITIES } from "./tool-spec"

// Minimal subset of OpenCode auth.json's openai OAuth entry required by this plugin.
export type OpenAIAuth = { type: "oauth"; access: string; accountId?: string }

export type ImageModel = (typeof IMAGE_MODELS)[number]

export type ImageAction = (typeof IMAGE_ACTIONS)[number]

export type InputFidelity = (typeof INPUT_FIDELITIES)[number]

export type GenerateArgs = {
  prompt: string
  out: string
  quality: "low" | "medium" | "high" | "auto"
  size?: string
  model?: ImageModel
  images?: string[]
  action?: ImageAction
  inputFidelity?: InputFidelity
  mask?: string
}

// Fields the backend reports about the image it actually produced. Every field is optional:
// backends omit some or all of them, and generation must not fail when they are absent.
export type ReportedImageFields = {
  revisedPrompt?: string
  size?: string
  quality?: string
  model?: string
}
