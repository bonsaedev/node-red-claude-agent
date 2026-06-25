import { defineConfig, mergeConfig } from "vitest/config";
import { defaultConfig } from "@bonsae/nrg/test/server/unit/config";

export default mergeConfig(
  defaultConfig,
  defineConfig({
    test: {
      include: ["tests/server/**/*.test.ts"],
    },
  }),
);
