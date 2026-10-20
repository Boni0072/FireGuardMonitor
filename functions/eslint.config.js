const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

module.exports = [
  {
    ignores: ["lib/**", "generated/**", "node_modules/**"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: ["tsconfig.json", "tsconfig.dev.json"],
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // Estilo compatível com o código do projeto (sem travar deploy no Windows)
      quotes: ["error", "double"],
      indent: ["error", 2],
      "object-curly-spacing": ["error", "always"],
      "linebreak-style": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
];
