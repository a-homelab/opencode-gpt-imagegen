import { callViaCodexResponses } from "./codex"
import { readMaskImage, readReferenceImages } from "./input-image"
import { saveGeneratedImage } from "./output-image"
import { IMAGE_ACTIONS, INPUT_FIDELITIES } from "./tool-spec"
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

// Refuse edit inputs the hosted tool cannot honor before any file is read or request sent.
// The v2 host passes input through without schema validation, so the enums are checked here too.
export function validateEditArgs(args: GenerateArgs): void {
  if (args.action !== undefined && !(IMAGE_ACTIONS as readonly string[]).includes(args.action)) {
    throw new Error(`action must be one of ${IMAGE_ACTIONS.join(", ")}; got ${JSON.stringify(args.action)}`)
  }
  if (args.inputFidelity !== undefined && !(INPUT_FIDELITIES as readonly string[]).includes(args.inputFidelity)) {
    throw new Error(
      `inputFidelity must be one of ${INPUT_FIDELITIES.join(", ")}; got ${JSON.stringify(args.inputFidelity)}`,
    )
  }
  if (args.mask !== undefined && (typeof args.mask !== "string" || args.mask.length === 0)) {
    throw new Error("mask must be a non-empty file path")
  }
  const hasImages = (args.images?.length ?? 0) > 0
  if (args.action === "edit" && !hasImages) {
    throw new Error("action edit needs the image to edit as the first entry of images")
  }
  if (args.mask !== undefined && !hasImages) {
    throw new Error("mask applies to the first entry of images; pass at least one image")
  }
}

export async function generateImage(
  args: GenerateArgs,
  ctxDir: string,
  auth: OpenAIAuth | undefined,
  signal?: AbortSignal,
): Promise<GenerationResult> {
  signal?.throwIfAborted()
  validateEditArgs(args)
  if (!auth) {
    throw new Error("OpenAI ChatGPT OAuth credentials not configured.")
  }

  const inputImageDataUrls = await readReferenceImages(args.images, ctxDir)
  const maskDataUrl = await readMaskImage(args.mask, ctxDir)
  const { base64, reported } = await callViaCodexResponses(auth, args, inputImageDataUrls, signal, maskDataUrl)

  signal?.throwIfAborted()
  const { savedPath, versioned, message } = await saveGeneratedImage(args.out, ctxDir, base64)
  return { message, savedPath, versioned, reported }
}
