const js = require("@eslint/js");
const globals = require("globals");
const tseslint = require("typescript-eslint");
const react = require("eslint-plugin-react");
const reactHooks = require("eslint-plugin-react-hooks");
// A partir da v0.5 o plugin virou ESM e passou a expor um export NOMEADO.
// A regra `only-export-components` também saiu da raiz do objeto: agora ela vem
// pronta dentro dos presets (`configs.recommended()` / `vite()` / `next()`).
// Registrar o plugin "na mão" como antes faz o ESLint não achar a regra.
const { reactRefresh } = require("eslint-plugin-react-refresh");

module.exports = tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "eslint.config.js"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Preset "vite": liga only-export-components com `allowConstantExport`, que é
  // o comportamento correto para o plugin React do Vite (era o que fazíamos à mão).
  reactRefresh.configs.vite(),
  {
    languageOptions: {
      globals: {
        ...globals.browser
      }
    },
    settings: {
      react: { version: "detect" }
    },
    plugins: {
      react,
      "react-hooks": reactHooks
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }]
    }
  }
);

