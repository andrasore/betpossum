import "@radix-ui/themes/styles.css";
import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import localFont from "next/font/local";
import { Providers } from "./providers";

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

// Druk Wide is a commercial typeface (no Google Fonts build), bundled from the
// licensed file via next/font/local. Used only for the BetPossum brand wordmark
// in the Navbar, which is always bold.
const drukWide = localFont({
  src: [
    { path: "../../public/DrukWideBold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${ibmPlexSans.variable} ${drukWide.variable}`}
    >
      <head>
        {/* Generated at nginx startup from KEYCLOAK_ISSUER /
            KEYCLOAK_CLIENT_ID; same image runs on dev (8080/8090) and e2e
            (18080/18090) without rebuild. */}
        <script src="/config.js" />
      </head>
      <body
        style={{
          fontFamily: "var(--font-sans), system-ui, sans-serif",
          fontVariantNumeric: "tabular-nums oldstyle-nums",
        }}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
