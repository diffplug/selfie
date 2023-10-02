import { AppProps } from "next/app";
import Head from "next/head";
import { MDXProvider } from "@mdx-js/react";

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
        <Component {...pageProps} />
      </MDXProvider>
    </>
  );
}
