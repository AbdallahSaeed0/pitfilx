/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        pitflix: {
          bg: "#141414",
          surface: "#1F1F1F",
          card: "#2A2A2A",
          primary: "#7B2FBE",
          light: "#9B59B6",
          dark: "#5B1F8E",
          accent: "#A855F7",
          muted: "#B3B3B3",
          subtle: "#666666",
        },
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "sans-serif"],
      },
      keyframes: {
        "match-indeterminate": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(400%)" },
        },
      },
      animation: {
        "match-indeterminate": "match-indeterminate 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
