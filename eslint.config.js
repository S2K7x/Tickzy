import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "design/**", "docs/**", "**/*.config.*", "**/scripts/*.cjs"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Module boundary rule (ADR-001): server modules may not import other modules' internals.
      "no-restricted-imports": ["error", { patterns: [{ group: ["**/modules/*/internal/**"], message: "Import a module's public index, not its internals." }] }]
    }
  }
);
