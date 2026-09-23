import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "apps/extension/public/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
        // Type information is what makes the promise rules below possible.
        // Without `projectService` they are silently inert.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    rules: {
      "no-constant-binary-expression": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-dupe-else-if": "error",
      "no-duplicate-case": "error",
      "no-unreachable": "error",
      "no-unsafe-finally": "error",

      // A dropped promise in a service worker is an error that never surfaces:
      // the worker may be evicted before the rejection is ever observed.
      // `void expr` stays allowed because the codebase uses it deliberately to
      // mark fire-and-forget calls.
      "@typescript-eslint/no-floating-promises": [
        "error",
        { ignoreVoid: true, ignoreIIFE: true },
      ],
      // Passing an async function where a void callback is expected means the
      // caller cannot await it and cannot see it fail — common in DOM event
      // handlers and chrome.* listeners.
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",

      // Stale closures in a 4 500-line content script full of timers and
      // observers are exactly the bug class these two rules catch.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    // Test files may await freely and reach for loose shapes in fixtures.
    files: ["**/test/**/*.ts", "**/test/**/*.tsx", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
];
