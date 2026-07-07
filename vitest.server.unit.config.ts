import { defineConfig, mergeConfig } from "vitest/config";
import { nrg } from "@bonsae/nrg/test/server/unit/config";

export default mergeConfig(
  nrg,
  defineConfig({
    test: {
      include: ["tests/server/**/*.test.ts"],
    },
  }),
);
