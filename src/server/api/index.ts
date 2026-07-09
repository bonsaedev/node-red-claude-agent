import type { RED } from "@bonsae/nrg/server";
import { initClaudeFolderRoutes } from "./claude-folder";

function initRoutes(RED: RED): void {
  initClaudeFolderRoutes(RED);
}

export { initRoutes };
