import { defineNode } from "@bonsae/nrg/client";
import ClaudeAgentConfigurationForm from "../components/claude-agent-configuration.vue";

export default defineNode({
  type: "claude-agent-configuration",
  form: { component: ClaudeAgentConfigurationForm },
});
