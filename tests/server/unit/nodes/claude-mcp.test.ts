import { describe, it, expect } from "vitest";
import { createNode } from "@bonsae/nrg/test/server/unit";
import ClaudeMcp from "../../../../src/server/nodes/claude-mcp";
import ClaudeAgentConfiguration from "../../../../src/server/nodes/claude-agent-configuration";
import type { RunContext } from "../../../../src/server/lib/tool-dispatch";

async function mcp(
  config: Record<string, unknown>,
  credentials: Record<string, unknown> = {},
) {
  const { node } = await createNode(ClaudeMcp, { config, credentials });
  return node;
}

const RUN: RunContext = {
  correlationId: undefined,
  signal: new AbortController().signal,
  agentNodeId: "agent-1",
  public: () => ({ nodeId: "agent-1" }),
};

describe("claude-mcp", () => {
  describe("toConfig", () => {
    it("builds an http server config with a Bearer header from the secret", async () => {
      const node = await mcp(
        { serverName: "github", transport: "http", url: "https://x/mcp" },
        { secret: "PAT" },
      );
      expect(node.toConfig()).toEqual({
        type: "http",
        url: "https://x/mcp",
        headers: { Authorization: "Bearer PAT" },
        timeout: 30000,
      });
    });

    it("uses a raw header value when a non-Authorization header is chosen", async () => {
      const node = await mcp(
        {
          serverName: "github",
          transport: "http",
          url: "https://x/mcp",
          headerName: "X-Api-Key",
        },
        { secret: "PAT" },
      );
      const cfg = node.toConfig() as { headers: Record<string, string> };
      expect(cfg.headers).toEqual({ "X-Api-Key": "PAT" });
    });

    it("builds an sse server config", async () => {
      const node = await mcp({
        serverName: "events",
        transport: "sse",
        url: "https://x/sse",
      });
      expect(node.toConfig()).toMatchObject({
        type: "sse",
        url: "https://x/sse",
      });
    });

    it("builds a stdio server config with split args and an env-carried secret", async () => {
      const node = await mcp(
        {
          serverName: "fs",
          transport: "stdio",
          command: "npx",
          args: "-y, @modelcontextprotocol/server-filesystem, /data",
          envName: "FS_TOKEN",
        },
        { secret: "s3cr3t" },
      );
      expect(node.toConfig()).toEqual({
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
        env: { FS_TOKEN: "s3cr3t" },
        timeout: 30000,
      });
    });

    it("drops a timeout below the SDK's 1000ms floor", async () => {
      const node = await mcp({
        serverName: "x",
        transport: "http",
        url: "https://x/mcp",
        timeout: 500,
      });
      expect(node.toConfig()).not.toHaveProperty("timeout");
    });
  });

  describe("allowedToolGrant", () => {
    it("grants a wildcard when preApproveAll is on", async () => {
      const node = await mcp({
        serverName: "github",
        transport: "http",
        url: "https://x/mcp",
        preApproveAll: true,
      });
      expect(node.allowedToolGrant()).toBe("mcp__github__*");
    });

    it("grants nothing when preApproveAll is off", async () => {
      const node = await mcp({
        serverName: "github",
        transport: "http",
        url: "https://x/mcp",
      });
      expect(node.allowedToolGrant()).toBeUndefined();
    });
  });

  describe("assembleContributions folding (on the config node)", () => {
    /** Stub the config node's `mcps` getter with lightweight stand-ins. */
    async function configWithMcps(
      mcps: Array<{
        serverName: string;
        toConfig: () => unknown;
        allowedToolGrant: () => string | undefined;
      }>,
    ) {
      const { node } = await createNode(ClaudeAgentConfiguration, {
        config: {},
        credentials: { apiKey: "sk-test" },
      });
      Object.defineProperty(node, "mcps", { get: () => mcps });
      Object.defineProperty(node, "tools", { get: () => [] });
      return node;
    }

    const stub = (serverName: string, grant?: string) => ({
      serverName,
      toConfig: () => ({ type: "http", url: `https://${serverName}/mcp` }),
      allowedToolGrant: () => grant,
    });

    it("folds each external server under its name and collects pre-approve grants", async () => {
      const node = await configWithMcps([
        stub("github", "mcp__github__*"),
        stub("filesystem"),
      ]);
      const contrib = node.assembleContributions(RUN);

      expect(contrib.mcpServers.github).toMatchObject({ type: "http" });
      expect(contrib.mcpServers.filesystem).toMatchObject({ type: "http" });
      expect(contrib.allowedTools).toEqual(["mcp__github__*"]);
    });

    it("throws on a duplicate server name (a silent Record overwrite otherwise)", async () => {
      const node = await configWithMcps([stub("github"), stub("github")]);
      expect(() => node.assembleContributions(RUN)).toThrow(
        /both use server name "github"/,
      );
    });

    it("throws when an external server takes the reserved 'flow' name", async () => {
      const node = await configWithMcps([stub("flow")]);
      expect(() => node.assembleContributions(RUN)).toThrow(
        /reserved server name "flow"/,
      );
    });
  });
});
