/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        pitflix: {
          // Legacy tokens (keep for compatibility)
          bg: "#141414",
          surface: "#1F1F1F",
          card: "#2A2A2A",
          primary: "#7B2FBE",
          light: "#9B59B6",
          dark: "#5B1F8E",
          accent: "#A855F7",
          muted: "#B3B3B3",
          subtle: "#666666",
          
          // Cinematic design system tokens
          "bg-base": "#0A0A0A",
          "bg-elevated": "#141414",
          "bg-card": "#1C1C1C",
          "border-subtle": "#2A2A2A",
          "border-medium": "#3A3A3A",
          "text-primary": "#FFFFFF",
          "text-secondary": "#E5E5E5",
          "text-muted": "#A3A3A3",
          "text-subtle": "#737373",
          "accent-primary": "#8B5CF6",
          "accent-hover": "#A78BFA",
          "accent-soft": "#8B5CF620",
          "status-playing": "#10B981",
          "status-paused": "#F59E0B",
          "status-closed": "#6B7280",
          "status-finished": "#3B82F6",
          "status-error": "#EF4444",
        },
      },
      fontSize: {
        hero: ["2.5rem", { lineHeight: "1.2", fontWeight: "700" }],
        title: ["1.5rem", { lineHeight: "1.3", fontWeight: "600" }],
        subtitle: ["1.125rem", { lineHeight: "1.4", fontWeight: "500" }],
        body: ["0.875rem", { lineHeight: "1.5", fontWeight: "400" }],
        caption: ["0.75rem", { lineHeight: "1.4", fontWeight: "400" }],
        micro: ["0.625rem", { lineHeight: "1.3", fontWeight: "400" }],
      },
      fontFamily: {
        sans: ["Inter", "Segoe UI", "sans-serif"],
      },
      keyframes: {
        "match-indeterminate": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(400%)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-in-from-bottom": {
          "0%": { transform: "translateY(1rem)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "match-indeterminate": "match-indeterminate 1.1s ease-in-out infinite",
        "fade-in": "fade-in 0.25s ease-out",
        "slide-in-from-bottom": "slide-in-from-bottom 0.3s ease-out",
      },
      transitionDuration: {
        "250": "250ms",
      },
    },
  },
  plugins: [],
};
