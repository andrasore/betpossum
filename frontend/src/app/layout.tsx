import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BetApp',
  description: 'Live sports betting',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-100 antialiased">{children}</body>
    </html>
  );
}
