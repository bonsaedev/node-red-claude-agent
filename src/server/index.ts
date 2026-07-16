import { defineModule } from "@bonsae/nrg/server";
import ClaudeAgentConfiguration from "./nodes/claude-agent-configuration";
import ClaudeAgent from "./nodes/claude-agent";
import ClaudeTool from "./nodes/claude-tool";
import ClaudeToolReturn from "./nodes/claude-tool-return";
import ClaudeMcp from "./nodes/claude-mcp";
import McpServer from "./nodes/mcp-server";
import McpToolIn from "./nodes/mcp-tool-in";
import McpToolOut from "./nodes/mcp-tool-out";

export default defineModule({
  nodes: [
    ClaudeAgentConfiguration,
    ClaudeAgent,
    ClaudeTool,
    ClaudeToolReturn,
    ClaudeMcp,
    McpServer,
    McpToolIn,
    McpToolOut,
  ],
});
