import js from "@eslint/js"
import reactHooks from "eslint-plugin-react-hooks"
import globals from "globals"
import tseslint from "typescript-eslint"

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "fixtures/**", "**/.tsbuild/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // The public API is generic over a field-key union; `any` is never used,
      // but targeted casts at framework boundaries are.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    },
  },
  {
    files: ["packages/react/**/*.{ts,tsx}", "packages/ui-react/**/*.{ts,tsx}", "apps/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ["**/test/**", "tools/**"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
)
