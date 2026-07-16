import { defineConfig, mergeConfig } from "vitest/config";
import { nrg } from "@bonsae/nrg/test/server/integration/config";

export default mergeConfig(
  nrg,
  defineConfig({
    test: {
      include: ["tests/server/integration/**/*.test.ts"],
    },
  }),
);
