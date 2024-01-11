/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,mjs,jsx,mdx,tsx}"],
  theme: {
    extend: {
      colors: {
        black: "#4D4D4D",
        blue: "#63B9E3",
        green: "#78ACAE",
        red: "#E35C61",
        grey: "#EEE",
        purple: "#8250DF",
      },
      boxShadow: {
        button: "2px 2px 1px #4D4D4D",
        "button-tablet": "4px 4px 2px #4D4D4D",
      },
      dropShadow: {
        logo: "3px 3px 2px #4D4D4D",
        "logo-wide-phone": "3px 3px 2px #4D4D4D",
        "logo-tablet": "5px 5px 2px #4D4D4D",
        "logo-desktop": "5px 5px 2px #4D4D4D",
      },
      animation: {
        "slide-and-fade":
          "slide 1s linear calc(var(--page-scroll) * -0.9s) paused," +
          "customFade 1s linear calc(var(--literal-scroll) * -0.9s) paused",
      },
      keyframes: {
        slide: {
          to: {
            transform: "translateY(var(--innerHeight))",
          },
        },
        customFade: {
          from: {
            opacity: 1,
          },
          to: {
            opacity: 0.2,
          },
        },
      },
    },
    fontFamily: {
      sans: "'Jost', sans-serif",
      logo: "'Bagel Fat One', cursive",
    },
    fontSize: {
      sm: [
        "16px",
        {
          lineHeight: "1.2em",
          fontWeight: 400,
        },
      ],
      base: [
        "22px",
        {
          lineHeight: "1.4em",
          fontWeight: 400,
        },
      ],
      lg: [
        "30px",
        {
          lineHeight: "1.25em",
          fontWeight: 400,
        },
      ],
      xl: [
        "34px",
        {
          lineHeight: "1.2em",
          fontWeight: 400,
        },
      ],
      "2xl": [
        "45px",
        {
          lineHeight: "1em",
          fontWeight: 400,
        },
      ],
    },
    screens: {
      "wide-phone": "605px",
      tablet: "725px",
      desktop: "1159px",
      xl: "1300px",
    },
  },
};
