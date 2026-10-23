/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Each school's brand colour, set at runtime as "R G B" in --brand-rgb.
        brand: "rgb(var(--brand-rgb) / <alpha-value>)",
      },
      fontFamily: {
        sans: ['"IBM Plex Sans Arabic"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "Tahoma", "sans-serif"],
      },
    },
  },
  plugins: [],
};
