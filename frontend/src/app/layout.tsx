import "@radix-ui/themes/styles.css";
import type { Metadata } from "next";
import { Noto_Sans } from "next/font/google";
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
        {/* Generated at nginx startup from KEYCLOAK_ISSUER /
            KEYCLOAK_CLIENT_ID; same image runs on dev (8080/8090) and e2e
            (18080/18090) without rebuild. */}
        <script src="/config.js" />
      </head>
      <body style={{ fontFamily: "var(--font-sans), system-ui, sans-serif" }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
