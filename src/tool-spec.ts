// Tool metadata shared by the v1 (zod) and v2 (JSON Schema) registrations, so the
// model sees identical tool descriptions whichever plugin API OpenCode loads.
export const TOOL_DESCRIPTION = [
  "Generate raster images using OpenAI's hosted image_generation tool.",
  "Use for AI-created bitmap visuals such as photos, illustrations, textures, sprites, and mockups.",
  "Do not use when the task is better handled by editing existing SVG/vector/code-native assets, extending an established icon or logo system, or building the visual directly in HTML/CSS/canvas.",
  "Reference images may be attached through `images`; label each image's role inline in `prompt`, for example: 'Image 1: reference image'.",
  "To change an existing picture rather than draw a new one, pass it as the first image with `action: edit`; `mask` limits the change to the mask's transparent area.",
  "For many distinct assets, invoke gpt_imagegen once per requested asset rather than relying on multi-image output; gpt_imagegen returns one image per call.",
  "Requires OpenCode to be authenticated with ChatGPT OAuth. Returns the absolute path of the saved PNG.",
].join(" ")

// Image models the hosted image_generation tool accepts, newest first. This is the single
// source of truth for both the zod enum and the JSON Schema enum.
// https://developers.openai.com/api/docs/guides/image-generation
export const IMAGE_MODELS = [
  "gpt-image-2.5-sunburst",
  "gpt-image-2.5-flare",
  "gpt-image-2",
  "gpt-image-1.5",
  "gpt-image-1",
  "gpt-image-1-mini",
] as const

// Values of the hosted image_generation tool's `action` and `input_fidelity` fields.
// https://developers.openai.com/api/reference/resources/responses/methods/create
export const IMAGE_ACTIONS = ["generate", "edit", "auto"] as const
export const INPUT_FIDELITIES = ["high", "low"] as const

export const FIELD_DESCRIPTIONS = {
  prompt: "Description of the image to generate.",
  out: "Output file path, relative to the project directory unless absolute. The plugin writes a PNG.",
  quality: "Generation quality passed to the hosted image_generation tool.",
  size: "Optional image size passed to the hosted image_generation tool. Use `auto` or `WIDTHxHEIGHT`; width and height must be multiples of 16px, max edge <= 3840px, long-to-short ratio <= 3:1, and total pixels between 655,360 and 8,294,400.",
  model:
    "Optional image model that renders the picture, passed to the hosted image_generation tool. This is not your own chat model. Omit it to let the backend choose. `gpt-image-2.5-sunburst` is the flagship model, best for detailed photorealism but slower; `gpt-image-2.5-flare` is the fast default. Earlier models remain available for reproducing previous output.",
  images: "Optional reference image paths, relative to the project directory unless absolute.",
  action:
    "Optional: whether the hosted tool draws a new image (`generate`) or changes the first reference image (`edit`). Omit it, or pass `auto`, to let the backend decide from the prompt. `edit` requires at least one image in `images`.",
  inputFidelity:
    "Optional: how closely the output keeps the details of the reference images. `gpt-image-1` and `gpt-image-1.5` accept `high` and `low`, `gpt-image-1-mini` only `low`; omit it for `gpt-image-2` and newer, which always read input images at high fidelity.",
  mask: "Optional PNG mask path, relative to the project directory unless absolute. Its transparent pixels mark where the first reference image may change; it must match that image's size and needs an alpha channel. Requires at least one image in `images`.",
} as const

// JSON Schema form of the tool input, used by the OpenCode v2 tool API.
export const TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    prompt: { type: "string", description: FIELD_DESCRIPTIONS.prompt },
    out: { type: "string", description: FIELD_DESCRIPTIONS.out },
    quality: {
      type: "string",
      enum: ["low", "medium", "high", "auto"],
      description: FIELD_DESCRIPTIONS.quality,
    },
    size: { type: "string", description: FIELD_DESCRIPTIONS.size },
    model: {
      type: "string",
      enum: IMAGE_MODELS,
      description: FIELD_DESCRIPTIONS.model,
    },
    images: {
      type: "array",
      items: { type: "string" },
      description: FIELD_DESCRIPTIONS.images,
    },
    action: {
      type: "string",
      enum: IMAGE_ACTIONS,
      description: FIELD_DESCRIPTIONS.action,
    },
    inputFidelity: {
      type: "string",
      enum: INPUT_FIDELITIES,
      description: FIELD_DESCRIPTIONS.inputFidelity,
    },
    mask: { type: "string", description: FIELD_DESCRIPTIONS.mask },
  },
  required: ["prompt", "out", "quality"],
  additionalProperties: false,
} as const
