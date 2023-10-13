import { Head, Html, Main, NextScript } from "next/document";

export default function Document() {
  return (
    <Html lang="en" className="scroll-smooth">
      <Head>
        <link rel="preconnect" href="https://fonts.gstatic.com" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bagel+Fat+One&family=Jost:ital,wght@0,400;0,700;1,400&display=swap"
          rel="stylesheet"
        />
        <link
          href="/logo-icon.svg"
          rel="icon"
          type="image/svg"
          sizes="32x32"
        ></link>
      </Head>
      <body>
        <div className="flex justify-center text-black antialiased">
          <div className="w-full max-w-[1300px]">
            <Main />
            <NextScript />
          </div>
        </div>
      </body>
    </Html>
  );
}
