import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      // Saída de build: cópias do vendor/ (que já é ignorado). Sem isto,
      // `pnpm lint` falhava com 200+ erros em arquivo gerado.
      "**/dist-extension/**",
      "apps/desktop/release*/**",
      "**/node_modules/**",
      "vendor/**",
      "docs/**",
      "**/*.md",
      "pnpm-lock.yaml",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Tentei `no-use-before-define` aqui depois de um ReferenceError por zona
      // morta temporal derrubar a criação da janela. Medido: marca 10 pontos em
      // workspace-window.ts e 9 são seguros (referência dentro de callback, que
      // só é lida no clique). Regra que erra 9 de 10 vira regra desligada — pior
      // que não ter. O que pega esse bug de verdade é o smoke com janela; ver
      // docs/RELEASE.md.
    },
  },
  {
    // Roda no renderer (shell/titlebar/overlay/painel), não no Node.
    files: ["apps/desktop/src/shell/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Preload do Electron é CommonJS por contrato: require() é obrigatório.
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Este preload roda dentro de páginas web e acessa DOM real do renderer.
    files: [
      "apps/desktop/src/preload/composer-preload.cjs",
      "apps/desktop/src/preload/microsoft-badge-preload.cjs",
      "apps/desktop/src/preload/form-activity-preload.cjs",
    ],
    languageOptions: { globals: { ...globals.browser } },
  },
);
