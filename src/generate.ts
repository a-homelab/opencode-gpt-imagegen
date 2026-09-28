import { callViaCodexResponses } from "./codex"
import { readReferenceImages } from "./input-image"
import { saveGeneratedImage } from "./output-image"
import type { GenerateArgs, ImageModel, OpenAIAuth, ReportedImageFields } from "./types"

export type GenerationResult = {
  message: string
  savedPath: string
  versioned: boolean
  reported: ReportedImageFields
}

// Tool-result metadata describing which image model was asked for and what the backend said it
// produced. `imageModel` is absent when the caller did not choose one, so a reader can tell a
// backend default apart from an explicit request.
export function imageModelMetadata(
  requested: ImageModel | undefined,
  reported: ReportedImageFields,
): Record<string, string> {
  return {
    ...(requested ? { imageModel: requested } : {}),
    ...(reported.model ? { reportedImageModel: reported.model } : {}),
    ...(reported.size ? { reportedSize: reported.size } : {}),
    ...(reported.quality ? { reportedQuality: reported.quality } : {}),
    ...(reported.revisedPrompt ? { revisedPrompt: reported.revisedPrompt } : {}),
  }
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
  const { base64, reported } = await callViaCodexResponses(auth, args, inputImageDataUrls, signal)

  signal?.throwIfAborted()
  const { savedPath, versioned, message } = await saveGeneratedImage(args.out, ctxDir, base64)
  return { message, savedPath, versioned, reported }
}
