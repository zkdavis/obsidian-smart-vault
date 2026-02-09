import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

export default defineConfig([
    {
        files: ["**/*.ts"],
        plugins: {
            "@typescript-eslint": tseslint.plugin,
            "obsidianmd": obsidianmd,
        },
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                project: "./tsconfig.json",
                tsconfigRootDir: import.meta.dirname,
            },
            globals: {
                ...globals.browser,
                ...globals.node,
            },
        },
        rules: {
            // ONLY rules mentioned in the PR review:

            // 1. Use sentence case for UI text
            "obsidianmd/ui/sentence-case": [
                "warn",
                {
                    brands: [],
                    acronyms: ["AI", "LLM", "HTTP", "PDF", "OCR", "JSON", "URL", "ID", "CPU", "RAM", "API", "UI", "Markdown", "PNG", "JPG", "JPEG", "WEBP"],
                    enforceCamelCaseLower: true,
                    allowAutoFix: true,
                },
            ],

            // 2. Unexpected await of a non-Promise value
            "@typescript-eslint/await-thenable": "error",

            // 3. Async arrow function has no 'await' expression
            "@typescript-eslint/require-await": "error",

            // 4. Promises must be awaited or handled
            "@typescript-eslint/no-floating-promises": "error",
        },
    },
]);