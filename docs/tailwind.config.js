/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,mjs,jsx,mdx,tsx}"],
  theme: {
    extend: {
      colors: {
        blue: "#63B9E3",
        green: "#78ACAE",
        red: "#E35C61",
      },
      dropShadow: {
        logo: "5px 5px 2px #000",
      },
    },
    fontFamily: {
      sans: "'Jost', sans-serif",
      logo: "'Bagel Fat One', cursive",
    },
    screens: {
      "wide-phone": "600px",
      tablet: "800px",
      desktop: "1159px",
    },
  },
};
