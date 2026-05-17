import type { Metadata } from 'next';
import { Noto_Sans } from 'next/font/google';
import { Providers } from './providers';

const notoSans = Noto_Sans({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'BetPossum',
  description: 'Live sports betting',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={notoSans.variable}>
      <body style={{ fontFamily: 'var(--font-sans), system-ui, sans-serif' }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
