/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // antd owns component styling; Tailwind here is layout + type scale.
      fontFamily: {
        ui: [
          '"IBM Plex Sans"',
          "system-ui",
          "-apple-system",
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          '"Noto Sans CJK SC"',
          "sans-serif",
        ],
        display: ['"Fraunces Variable"', '"IBM Plex Sans"', '"PingFang SC"', "serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        micro: ["11px", { lineHeight: "1.3", letterSpacing: "0.06em" }],
        meta: ["12px", { lineHeight: "1.4" }],
        small: ["13px", { lineHeight: "1.45" }],
        body: ["14px", { lineHeight: "1.5" }],
        section: ["15px", { lineHeight: "1.4" }],
        title: ["18px", { lineHeight: "1.3" }],
        display: ["24px", { lineHeight: "1.2" }],
      },
      // Elevation tokens (DESIGN §5.4). The values live in index.css so the
      // light/dark pair stays in one place; `shadow-e3` etc. resolve to them.
      boxShadow: {
        e1: "var(--e1)",
        e2: "var(--e2)",
        e3: "var(--e3)",
      },
    },
  },
  plugins: [],
};
