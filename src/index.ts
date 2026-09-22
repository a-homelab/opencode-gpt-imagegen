import type { Hooks, Plugin, PluginInput, PluginModule } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { loadOpenAIAuth } from "./auth"
import { generateImage } from "./generate"
import { FIELD_DESCRIPTIONS, TOOL_DESCRIPTION } from "./tool-spec"
import { setupV2, V2_PLUGIN_ID } from "./v2"

const GptImagePlugin: Plugin = async (_input: PluginInput): Promise<Hooks> => {
  return {
    tool: {
      gpt_imagegen: tool({
        description: TOOL_DESCRIPTION,
        // https://developers.openai.com/api/docs/guides/image-generation
        args: {
          prompt: tool.schema.string().describe(FIELD_DESCRIPTIONS.prompt),
          out: tool.schema.string().describe(FIELD_DESCRIPTIONS.out),
          quality: tool.schema.enum(["low", "medium", "high", "auto"]).describe(FIELD_DESCRIPTIONS.quality),
          size: tool.schema.string().optional().describe(FIELD_DESCRIPTIONS.size),
          images: tool.schema.array(tool.schema.string()).optional().describe(FIELD_DESCRIPTIONS.images),
        },
        async execute(args, ctx) {
          const { message, savedPath, versioned } = await generateImage(
            args,
            ctx.directory,
            await loadOpenAIAuth(),
            ctx.abort,
          )

          return {
            output: message,
            metadata: {
              out: savedPath,
              versioned,
              billing: "subscription",
            },
          }
        },
      }),
    },
  }
}

// OpenCode v1 calls server(); v2 calls setup().
export default {
  id: V2_PLUGIN_ID,
  setup: setupV2,
  server: GptImagePlugin,
} satisfies PluginModule & { setup: typeof setupV2 }
