/** Shared design tokens for marketing, developer portal and admin. Colors are CSS variables (see styles.css). */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
module.exports = {
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v("bg"), surface: v("surface"), muted: v("muted"), line: v("line"),
        ink: { DEFAULT: v("ink"), 2: v("ink-2"), 3: v("ink-3") },
        brand: { DEFAULT: v("brand"), ink: v("brand-ink"), soft: v("brand-soft") },
        ok: v("ok"), warn: v("warn"), err: v("err"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "system-ui"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: { card: "14px" },
      boxShadow: { card: "0 1px 2px rgb(16 24 40 / .04), 0 1px 3px rgb(16 24 40 / .06)", pop: "0 18px 48px rgb(16 24 40 / .16)" },
    },
  },
};
