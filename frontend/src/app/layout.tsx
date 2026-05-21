import type { Metadata } from "next";
import { Noto_Sans } from "next/font/google";
import Script from "next/script";
import { Providers } from "./providers";

const notoSans = Noto_Sans({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "BetPossum",
  description: "Live sports betting",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={notoSans.variable}>
      <head>
        {/*
          window.__GATEWAY_PORT__ is set from a dynamic route handler
          (/runtime-config.js) that reads GATEWAY_PUBLIC_PORT at request
          time. Keeping the read in a route handler lets one image serve dev
          (8080) and e2e (18080) without forcing the rest of the app to
          render dynamically. beforeInteractive guarantees the script runs
          before any client bundle does.
        */}
        <Script
          src="/runtime-config.js"
          strategy="beforeInteractive"
        />
      </head>
      <body style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
