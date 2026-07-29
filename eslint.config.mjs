import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // eve's dev server writes a full snapshot of the source tree here on
    // every boot, so linting it re-reports every warning once per snapshot.
    ".eve/**",
    // `eve build` writes the bundled agent server here; it is generated,
    // minified output, not source.
    ".output/**",
    "drizzle/**",
  ]),
]);

export default eslintConfig;
