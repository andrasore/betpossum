import type { Metadata } from 'next';
import './globals.css';
import { Geist, Noto_Sans } from "next/font/google";
import { cn } from "@/lib/utils";

const notoSans = Noto_Sans({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: 'BetApp',
  description: 'Live sports betting',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("dark font-sans", "font-sans", notoSans.variable)}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
