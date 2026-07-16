import { ConfigNode, type Infer, type RED } from "@bonsae/nrg/server";
import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import McpToolIn from "./mcp-tool-in";
import { ConfigsSchema } from "../../shared/schemas/mcp-server";

type Config = Infer<typeof ConfigsSchema>;

/** `RED.httpNode` is Node-RED's user-facing Express app (typed by nrg). Express
 *  keeps its registered routes on the internal `app._router.stack`, which the
 *  public Express types don't model — the same internal core `http in` splices to
 *  drop its own route on redeploy, so re-deploying doesn't stack routes. */
type UserHttpServer = RED["httpNode"] & {
  _router?: {
    stack: Array<{
      route?: { path?: string; methods?: Record<string, boolean> };
    }>;
  };
};

/** Express-decorated request (body populated by Node-RED's parser middleware). */
type ExpressRequest = IncomingMessage & { body?: unknown };

/**
 * `mcp-server` — a pure ConfigNode that hosts a StreamableHTTP MCP endpoint on
 * Node-RED's Express app. Its `mcp-tool-in` nodes bind by identity (NodeRef) and
 * are exposed as MCP tools any client can call. STATELESS request/response: each
 * POST builds a fresh MCP server + transport from the flow's current tools, so
 * there is no session bookkeeping and edits take effect on the next request.
 */
export default class McpServer extends ConfigNode<Config> {
  static override readonly type = "mcp-server";
  static override readonly configSchema = ConfigsSchema;

  #app?: UserHttpServer;
  #path?: string;
  // The exact Express route layers THIS node registered, so teardown removes only
  // ours — never a co-path sibling server's routes.
  readonly #layers = new Set<object>();
  // Aborted on teardown so in-flight tool calls settle instead of hanging.
  readonly #close = new AbortController();
  // path -> owning node id, so a second server on the same path is caught loudly
  // (Express is first-match-wins, so it would otherwise silently shadow the tools).
  static readonly #pathOwners = new Map<string, string>();

  /** The tools bound to this server, pulled from the native `_users` reverse index
   *  — no registration protocol, recomputed from flow config every request. */
  get tools(): McpToolIn[] {
    return this.users.filter((n): n is McpToolIn => n instanceof McpToolIn);
  }

  override async created(): Promise<void> {
    const path = normalizePath(this.config.path);
    const httpNode = this.RED.httpNode as UserHttpServer;

    // Loud (non-fatal) guard: two mcp-server nodes on one path silently shadow —
    // Express is first-match-wins, so the second's tools become unreachable.
    const owner = McpServer.#pathOwners.get(path);
    if (owner && owner !== this.id) {
      this.RED.log.warn(
        `mcp-server: path "${path}" is already served by another mcp-server node — requests may be shadowed; give each server a distinct path.`,
      );
    } else {
      McpServer.#pathOwners.set(path, this.id);
    }

    // Capture the layer each registration appends, so closed() removes exactly ours.
    const captureLast = () => {
      const stack = httpNode._router?.stack;
      const layer = stack?.[stack.length - 1];
      if (layer) this.#layers.add(layer);
    };
    // POST: stateless MCP request/response (initialize, tools/list, tools/call).
    httpNode.post(path, (req: IncomingMessage, res: ServerResponse) => {
      void this.#handlePost(req as ExpressRequest, res);
    });
    captureLast();
    // GET/DELETE: stateless mode has no standalone SSE stream or session teardown.
    httpNode.get(path, (_req: IncomingMessage, res: ServerResponse) =>
      methodNotAllowed(res),
    );
    captureLast();
    httpNode.delete(path, (_req: IncomingMessage, res: ServerResponse) =>
      methodNotAllowed(res),
    );
    captureLast();

    this.#app = httpNode;
    this.#path = path;
  }

  override async closed(): Promise<void> {
    // Settle any in-flight tool calls (their handlers listen on this signal), then
    // remove ONLY the exact route layers we registered (by identity) so a co-path
    // sibling keeps its routes and a redeploy doesn't stack ours.
    this.#close.abort();
    if (this.#path && McpServer.#pathOwners.get(this.#path) === this.id) {
      McpServer.#pathOwners.delete(this.#path);
    }
    const stack = this.#app?._router?.stack;
    if (stack) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (this.#layers.has(stack[i])) stack.splice(i, 1);
      }
    }
    this.#layers.clear();
  }

  /** Build a fresh MCP server with every bound tool registered. Cheap enough to do
   *  per request (registering a tool is a map insertion); keeps the server stateless. */
  #buildServer(): SdkMcpServer {
    const server = new SdkMcpServer({
      name: this.config.serverName,
      version: "0.1.0",
    });
    const info = { nodeId: this.id, name: this.config.serverName };
    for (const tool of this.tools)
      tool.register(server, info, this.#close.signal);
    return server;
  }

  async #handlePost(req: ExpressRequest, res: ServerResponse): Promise<void> {
    const server = this.#buildServer();
    // Stateless: no session id, plain JSON responses (no long-lived SSE stream).
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      // Node-RED's body-parser middleware has already parsed JSON into req.body;
      // pass it so the transport doesn't try to re-read a drained stream.
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      this.RED.log.error(
        `mcp-server: request failed: ${(err as Error).message}`,
      );
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      }
    }
  }
}

function methodNotAllowed(res: ServerResponse): void {
  res.statusCode = 405;
  res.setHeader("Allow", "POST");
  res.end("Method Not Allowed");
}

/** Normalize a configured path to a leading-slash route (`mcp` → `/mcp`). */
function normalizePath(path: string | undefined): string {
  const trimmed = (path ?? "").trim();
  if (!trimmed) return "/mcp";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}
