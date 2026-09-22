import type { Plugin } from "@opencode/plugin"
import { loadV2OpenAIAuth } from "./auth"
import { generateImage } from "./generate"
import { TOOL_DESCRIPTION, TOOL_INPUT_SCHEMA } from "./tool-spec"
import type { GenerateArgs } from "./types"

export const V2_PLUGIN_ID = "opencode-gpt-imagegen"

export async function setupV2(ctx: Plugin.Context): Promise<void> {
  await ctx.tool.transform((editor) => {
    editor.add({
      name: "gpt_imagegen",
      description: TOOL_DESCRIPTION,
      input: TOOL_INPUT_SCHEMA,
      async execute(input, context) {
        context.signal?.throwIfAborted()
        const auth = await loadV2OpenAIAuth(ctx.integration.connection)
        const session = await ctx.session.get({ sessionID: context.sessionID })
        const { message, savedPath, versioned } = await generateImage(
          input as GenerateArgs,
          session.location.directory,
          auth,
          context.signal,
        )
        return {
          content: message,
          metadata: { out: savedPath, versioned, billing: "subscription" },
        }
      },
    })
  })
}
