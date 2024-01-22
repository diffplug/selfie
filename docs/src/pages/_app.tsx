import { Hero } from "@/components/Hero";
import { Navigation } from "@/components/Navigation/Navigation";
import * as mdxComponents from "@/components/mdx";
import "@/styles/tailwind.css";
import { MDXProvider } from "@mdx-js/react";
import clsx from "clsx";
import { AppProps } from "next/app";
import Head from "next/head";

export default function App({ Component, pageProps, router }: AppProps) {
  const pageTitle = pageProps.title || "Selfie";
  const pageDescription =
    pageProps.description || "Let your codebase take its own selfies.";
  const pageImage = pageProps.imageUrl || "https://selfie.dev/car-3072w.webp";
  const pageUrl = `https://selfie.dev${router.pathname}`;
  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:type" content="website" />
        <meta property="og:image" content={pageImage} />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:description" content={pageDescription} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta
          name="twitter:image"
          content={"https://selfie.dev/twitter-card.webp"}
        />
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
      </MDXProvider>
    </>
  );
}
