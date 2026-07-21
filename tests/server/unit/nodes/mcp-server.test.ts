import { describe, it, expect, vi } from "vitest";
import { createNode } from "@bonsae/nrg/test/server/unit";
import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import McpServer from "../../../../src/server/nodes/mcp-server";
import McpToolIn from "../../../../src/server/nodes/mcp-tool-in";
import { PendingIndex } from "../../../../src/server/lib/tool-dispatch";

const TOOL_CONFIG = {
  name: "get_weather",
  description: "Look up the weather",
  params: [
    {
      name: "city",
      type: "string",
      description: "The city to look up",
      required: true,
      values: "",
    },
  ],
  timeoutSeconds: 55,
};

describe("mcp-server", () => {
  describe("MCP protocol round-trip (in-memory transport)", () => {
    it("exposes a bound tool to a real MCP client and returns the flow's answer", async () => {
      // A real mcp-tool-in node registered on a real MCP server.
      const { node: toolNode } = await createNode(McpToolIn, {
        config: TOOL_CONFIG,
      });
      const server = new SdkMcpServer({ name: "test", version: "0.0.0" });
      toolNode.register(
        server,
        { nodeId: "srv-1", name: "test" },
        new AbortController().signal,
      );

      // A real MCP client on the other end of an in-memory transport pair.
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: "test-client", version: "0.0.0" });
      await client.connect(clientTransport);

      try {
        // The tool is advertised with its name, description, and derived schema.
        const listed = await client.listTools();
        const tool = listed.tools.find((t) => t.name === "get_weather");
        expect(tool).toBeDefined();
        expect(tool!.description).toBe("Look up the weather");
        expect(
          (tool!.inputSchema as { properties?: Record<string, unknown> })
            .properties?.city,
        ).toBeDefined();

        // Calling the tool parks a call + emits on `call`; the flow answers.
        const callP = client.callTool({
          name: "get_weather",
          arguments: { city: "SF" },
        });

        // The emission carries the args + a callId; settle it as the flow would,
        // taking the live resolver from the package `PendingIndex` by that callId.
        let callId: string | undefined;
        await vi.waitFor(() => {
          callId = toolNode.sent("call")[0]?._mcpTool?.callId;
          expect(callId).toBeDefined();
        });
        expect(toolNode.sent("call")[0].payload).toEqual({ city: "SF" });
        PendingIndex.take(callId!)!({
          value: "sunny",
          format: "text",
          isError: false,
        });

        const result = await callP;
        expect(result.content).toEqual([{ type: "text", text: "sunny" }]);
      } finally {
        await client.close();
        await server.close();
      }
    });
  });

  describe("http mounting", () => {
    it("mounts a POST route on the Node-RED Express app and starts with no tools", async () => {
      const { node, RED, error } = await createNode(McpServer, {
        config: { serverName: "test", path: "/mcp" },
      });

      expect(error).toBeUndefined();
      expect(node.tools).toEqual([]);
      const posted = vi.mocked(RED.httpNode.post).mock.calls.map((c) => c[0]);
      expect(posted).toContain("/mcp");

      // Teardown splices the route off the (mock) stack without throwing.
      await expect(node.close()).resolves.toBeUndefined();
    });

    it("normalizes a path with no leading slash", async () => {
      const { RED } = await createNode(McpServer, {
        config: { serverName: "test", path: "mcp" },
      });
      const posted = vi.mocked(RED.httpNode.post).mock.calls.map((c) => c[0]);
      expect(posted).toContain("/mcp");
    });
  });
});
