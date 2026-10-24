import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#f3ecdf",
        ink: "#1d1914",
        brick: "#8f3d24",
        card: "#fffaf3",
        line: "#e3d5c3",
      },
      fontFamily: {
        serif: ["Palatino Linotype", "Palatino", "Iowan Old Style", "Georgia", "serif"],
        sans: ["Segoe UI", "Helvetica Neue", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
