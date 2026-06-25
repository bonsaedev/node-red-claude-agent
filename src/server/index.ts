import { defineModule } from "@bonsae/nrg/server";
import ClaudeAgentConfiguration from "./nodes/claude-agent-configuration";
import ClaudeAgent from "./nodes/claude-agent";

export default defineModule({
  nodes: [ClaudeAgentConfiguration, ClaudeAgent],
});
