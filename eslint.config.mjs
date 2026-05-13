import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default defineConfig(
  { ignores: ["dist/", "node_modules/", "ui/acp-ui/", "ui/acp-ui-dist/"] },

  js.configs.recommended,

  {
    files: ["src/**/*.ts"],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: "./tsconfig.json" },
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  {
    files: ["tests/**/*.ts"],
    extends: [tseslint.configs.recommended],
    languageOptions: {
      parser: tseslint.parser,
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  {
    files: ["ui/**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },

  prettier,
);
