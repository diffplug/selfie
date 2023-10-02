import { AppProps } from "next/app";
import Head from "next/head";
import { MDXProvider } from "@mdx-js/react";
import clsx from "clsx";

import * as mdxComponents from "@/components/mdx";

import "@/styles/tailwind.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <title>Selfie</title>
        <meta name="description" content={pageProps.description} />
      </Head>
      <MDXProvider components={mdxComponents}>
        <div
          className={clsx([
            "flex",
            "flex-col",
            "gap-[10px]",
            "px-2",
            "wide-phone:px-4",
            "wide-phone:py-2",
          ])}
        >
          <Component {...pageProps} />
        </div>
      </MDXProvider>
    </>
  );
}
