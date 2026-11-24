import js from "@eslint/js";
import tseslint from "typescript-eslint";
import security from "eslint-plugin-security";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "design/**", "docs/**", "**/*.config.*", "**/scripts/*.cjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // SAST layer (T-112, SEC-13): unsafe regexes, eval-like calls, child_process, non-literal fs paths, timing attacks…
  security.configs.recommended,
  {
    rules: {
      // Flags every obj[key]; keys are constrained by TypeScript types and zod-validated input. Too noisy to be useful.
      "security/detect-object-injection": "off",
    },
  },
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Module boundary rule (ADR-001): server modules may not import other modules' internals.
      "no-restricted-imports": ["error", { patterns: [{ group: ["**/modules/*/internal/**"], message: "Import a module's public index, not its internals." }] }]
    }
  }
);
