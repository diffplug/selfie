import { FooterCTA } from "@/components/FooterCTA/FooterCTA";
import { Hero } from "@/components/Hero";
import { Navigation } from "@/components/Navigation/Navigation";
import * as mdxComponents from "@/components/mdx";
import "@/styles/tailwind.css";
import { MDXProvider } from "@mdx-js/react";
import clsx from "clsx";
import { AppProps } from "next/app";
import Head from "next/head";

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
          {pageProps.showHero ? <Hero /> : <Navigation {...pageProps} />}
        </div>
        <div className={clsx(["px-2", "wide-phone:px-4"])}>
          <Component {...pageProps} />
        </div>
        <FooterCTA />
      </MDXProvider>
    </>
  );
}
