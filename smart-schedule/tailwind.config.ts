import type { Config } from "tailwindcss";

/**
 * Tailwind CSS v4 uses CSS-first configuration via @theme in tokens.css.
 * This config file exists for compatibility with tools that expect it.
 * All design tokens are defined in src/styles/tokens.css.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
} satisfies Config;
