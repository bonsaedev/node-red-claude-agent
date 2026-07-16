import type { Server } from "node:http";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  IONode,
  type Input,
  type Outputs,
  type Port,
} from "@bonsae/nrg/server";
import {
  startRuntime,
  type Runtime,
} from "@bonsae/nrg/test/server/integration";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import McpServer from "../../../src/server/nodes/mcp-server";
import McpToolIn from "../../../src/server/nodes/mcp-tool-in";
import McpToolOut from "../../../src/server/nodes/mcp-tool-out";

/**
 * The intermediate node a flow author actually writes: read the tool args off the
 * envelope, (optionally) delay, then re-emit the answer under `payload` in the
 * DEFAULT passthrough mode — which carries `_msgid` forward, so the PRIVATE channel
 * holding the live resolver survives to mcp-tool-out. This is the real correlation
 * proof the unit harness can't give (it mints a fixed `_msgid`).
 */
type ComputeInput = Input<
  Port<{ output: { payload: { city?: string; ms?: number } } }>
>;
class Weather extends IONode<
  Record<string, never>,
  never,
  ComputeInput,
  Outputs<[Port<{ payload: unknown }>]>
> {
  static override readonly type = "weather";
  static override readonly category = "test";
  static override readonly color = "#cccccc";
  override async input(msg: ComputeInput) {
    const { city, ms } = msg.output.payload;
    if (ms) await new Promise((r) => setTimeout(r, ms));
    this.send(0, { payload: `weather in ${city}` });
  }
}

/** Returns a structured OBJECT under payload — for the json-format round-trip. */
class JsonReply extends IONode<
  Record<string, never>,
  never,
  Input<Port<{ output: { payload: { city?: string } } }>>,
  Outputs<[Port<{ payload: unknown }>]>
> {
  static override readonly type = "json-reply";
  static override readonly category = "test";
  static override readonly color = "#cccccc";
  override input(msg: Input<Port<{ output: { payload: { city?: string } } }>>) {
    this.send(0, { payload: { tempF: 72, city: msg.output.payload.city } });
  }
}

/** Returns an error the model should see — for the isError round-trip. */
class FailReply extends IONode<
  Record<string, never>,
  never,
  Input<Port<{ output: { payload: { city?: string } } }>>,
  Outputs<[Port<{ payload: unknown; isError: boolean }>]>
> {
  static override readonly type = "fail-reply";
  static override readonly category = "test";
  static override readonly color = "#cccccc";
  override input(msg: Input<Port<{ output: { payload: { city?: string } } }>>) {
    this.send(0, {
      payload: `no such city: ${msg.output.payload.city}`,
      isError: true,
    });
  }
}

/** Echoes the tool NAME it was called through — for multi-tool routing. */
class Echo extends IONode<
  Record<string, never>,
  never,
  Input<Port<{ output: { payload: unknown; mcpTool?: { name?: string } } }>>,
  Outputs<[Port<{ payload: unknown }>]>
> {
  static override readonly type = "echo";
  static override readonly category = "test";
  static override readonly color = "#cccccc";
  override input(
    msg: Input<
      Port<{ output: { payload: unknown; mcpTool?: { name?: string } } }>
    >,
  ) {
    this.send(0, { payload: `via ${msg.output.mcpTool?.name}` });
  }
}

const TOOL_PARAMS = [
  { name: "city", type: "string", description: "", required: true, values: "" },
  { name: "ms", type: "number", description: "", required: false, values: "" },
];

async function mcpClient(url: string): Promise<Client> {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

describe("mcp-server HTTP round-trip (real MCP client over real Node-RED)", () => {
  let runtime: Runtime;
  let baseUrl: string;

  beforeAll(async () => {
    runtime = await startRuntime({
      nodes: [
        McpServer,
        McpToolIn,
        McpToolOut,
        Weather,
        JsonReply,
        FailReply,
        Echo,
      ],
      settings: { httpNodeRoot: "/" },
    });
    const mod = (await import("node-red")) as unknown as { default?: unknown };
    const RED = (mod.default ?? mod) as {
      server?: Server & { on: (e: string, h: unknown) => void };
      httpNode?: unknown;
    };
    if (RED.server && RED.httpNode) RED.server.on("request", RED.httpNode);
    const address = RED.server?.address();
    if (!address || typeof address === "string") {
      throw new Error("could not resolve the Node-RED server port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  }, 30_000);

  afterAll(async () => {
    await runtime?.stop();
  });

  it("a real client lists the flow's tool and calls it through an intermediate node", async () => {
    const flow = runtime.flow();
    const server = flow.addNode(McpServer, {
      serverName: "flowtools",
      path: "/mcp",
    });
    const toolIn = flow.addNode(McpToolIn, {
      server: server.id,
      name: "get_weather",
      description: "Look up the weather",
      params: TOOL_PARAMS,
      timeoutSeconds: 20,
    });
    const weather = flow.addNode(Weather, {});
    const toolOut = flow.addNode(McpToolOut, { format: "text" });
    toolIn.wire(weather);
    weather.wire(toolOut);
    await flow.deploy();

    const client = await mcpClient(`${baseUrl}/mcp`);
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((t) => t.name)).toContain("get_weather");

      const result = await client.callTool({
        name: "get_weather",
        arguments: { city: "San Francisco" },
      });
      expect(result.content).toEqual([
        { type: "text", text: "weather in San Francisco" },
      ]);
      expect(result.isError).toBeFalsy();
    } finally {
      await client.close();
      await flow.clear();
    }
  });

  it("routes two concurrent calls to the right answers (per-_msgid correlation)", async () => {
    const flow = runtime.flow();
    const server = flow.addNode(McpServer, {
      serverName: "flowtools",
      path: "/mcp",
    });
    const toolIn = flow.addNode(McpToolIn, {
      server: server.id,
      name: "get_weather",
      description: "Look up the weather",
      params: TOOL_PARAMS,
      timeoutSeconds: 20,
    });
    const weather = flow.addNode(Weather, {});
    const toolOut = flow.addNode(McpToolOut, { format: "text" });
    toolIn.wire(weather);
    weather.wire(toolOut);
    await flow.deploy();

    const [a, b] = await Promise.all([
      mcpClient(`${baseUrl}/mcp`),
      mcpClient(`${baseUrl}/mcp`),
    ]);
    try {
      // SF completes LAST (150ms) though it started first — completion order is
      // scrambled, so a right answer proves routing is by _msgid, not arrival order.
      const [slow, fast] = await Promise.all([
        a.callTool({ name: "get_weather", arguments: { city: "SF", ms: 150 } }),
        b.callTool({ name: "get_weather", arguments: { city: "NYC", ms: 20 } }),
      ]);
      expect(slow.content).toEqual([{ type: "text", text: "weather in SF" }]);
      expect(fast.content).toEqual([{ type: "text", text: "weather in NYC" }]);
    } finally {
      await a.close();
      await b.close();
      await flow.clear();
    }
  });

  it("a tool with no return wired times out to an isError result (never hangs)", async () => {
    const flow = runtime.flow();
    const server = flow.addNode(McpServer, {
      serverName: "flowtools",
      path: "/mcp",
    });
    // call port wired to nothing — the flow never answers.
    flow.addNode(McpToolIn, {
      server: server.id,
      name: "get_weather",
      description: "Look up the weather",
      params: TOOL_PARAMS,
      timeoutSeconds: 2,
    });
    await flow.deploy();

    const client = await mcpClient(`${baseUrl}/mcp`);
    try {
      const result = await client.callTool({
        name: "get_weather",
        arguments: { city: "SF" },
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toMatch(/timed out/);
    } finally {
      await client.close();
      await flow.clear();
    }
  }, 15_000);

  it("a json-format return reaches the client as structuredContent", async () => {
    const flow = runtime.flow();
    const server = flow.addNode(McpServer, {
      serverName: "flowtools",
      path: "/mcp",
    });
    const toolIn = flow.addNode(McpToolIn, {
      server: server.id,
      name: "get_weather",
      description: "Look up the weather",
      params: TOOL_PARAMS,
      timeoutSeconds: 20,
    });
    const json = flow.addNode(JsonReply, {});
    const toolOut = flow.addNode(McpToolOut, { format: "json" });
    toolIn.wire(json);
    json.wire(toolOut);
    await flow.deploy();

    const client = await mcpClient(`${baseUrl}/mcp`);
    try {
      const result = await client.callTool({
        name: "get_weather",
        arguments: { city: "SF" },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ tempF: 72, city: "SF" });
    } finally {
      await client.close();
      await flow.clear();
    }
  });

  it("a flow that reports failure surfaces as an isError result the model sees", async () => {
    const flow = runtime.flow();
    const server = flow.addNode(McpServer, {
      serverName: "flowtools",
      path: "/mcp",
    });
    const toolIn = flow.addNode(McpToolIn, {
      server: server.id,
      name: "get_weather",
      description: "Look up the weather",
      params: TOOL_PARAMS,
      timeoutSeconds: 20,
    });
    const fail = flow.addNode(FailReply, {});
    const toolOut = flow.addNode(McpToolOut, { format: "text" });
    toolIn.wire(fail);
    fail.wire(toolOut);
    await flow.deploy();

    const client = await mcpClient(`${baseUrl}/mcp`);
    try {
      const result = await client.callTool({
        name: "get_weather",
        arguments: { city: "Nowhere" },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        { type: "text", text: "no such city: Nowhere" },
      ]);
    } finally {
      await client.close();
      await flow.clear();
    }
  });

  it("exposes several tools on one server and routes each call to its own flow", async () => {
    const flow = runtime.flow();
    const server = flow.addNode(McpServer, {
      serverName: "flowtools",
      path: "/mcp",
    });
    // Two tools on the SAME server, each wired to its own flow.
    const weatherIn = flow.addNode(McpToolIn, {
      server: server.id,
      name: "get_weather",
      description: "Weather",
      params: TOOL_PARAMS,
      timeoutSeconds: 20,
    });
    const echoIn = flow.addNode(McpToolIn, {
      server: server.id,
      name: "ping",
      description: "Ping",
      params: [],
      timeoutSeconds: 20,
    });
    const weather = flow.addNode(Weather, {});
    const echo = flow.addNode(Echo, {});
    const wOut = flow.addNode(McpToolOut, { format: "text" });
    const eOut = flow.addNode(McpToolOut, { format: "text" });
    weatherIn.wire(weather);
    weather.wire(wOut);
    echoIn.wire(echo);
    echo.wire(eOut);
    await flow.deploy();

    const client = await mcpClient(`${baseUrl}/mcp`);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(["get_weather", "ping"]);

      const w = await client.callTool({
        name: "get_weather",
        arguments: { city: "SF" },
      });
      expect(w.content).toEqual([{ type: "text", text: "weather in SF" }]);

      const p = await client.callTool({ name: "ping", arguments: {} });
      expect(p.content).toEqual([{ type: "text", text: "via ping" }]);
    } finally {
      await client.close();
      await flow.clear();
    }
  });
});
