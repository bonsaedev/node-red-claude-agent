import { defineModule } from "@bonsae/nrg/server";
import ClaudeAgentConfiguration from "./nodes/claude-agent-configuration";
import ClaudeAgent from "./nodes/claude-agent";
import ClaudeTool from "./nodes/claude-tool";
import ClaudeToolReturn from "./nodes/claude-tool-return";

export default defineModule({
  nodes: [ClaudeAgentConfiguration, ClaudeAgent, ClaudeTool, ClaudeToolReturn],
});
