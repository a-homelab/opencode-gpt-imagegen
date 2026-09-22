import { callViaCodexResponses } from "./codex"
import { readReferenceImages } from "./input-image"
import { saveGeneratedImage } from "./output-image"
import type { GenerateArgs, OpenAIAuth } from "./types"

export type GenerationResult = {
  message: string
  savedPath: string
  versioned: boolean
}

export async function generateImage(
  args: GenerateArgs,
  ctxDir: string,
  auth: OpenAIAuth | undefined,
  signal?: AbortSignal,
): Promise<GenerationResult> {
  signal?.throwIfAborted()
  if (!auth) {
    throw new Error("OpenAI ChatGPT OAuth credentials not configured.")
  }

  const inputImageDataUrls = await readReferenceImages(args.images, ctxDir)
  const base64 = await callViaCodexResponses(auth, args, inputImageDataUrls, signal)

  signal?.throwIfAborted()
  const { savedPath, versioned, message } = await saveGeneratedImage(args.out, ctxDir, base64)
  return { message, savedPath, versioned }
}
