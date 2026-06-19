"use client";

import { Theme } from "@radix-ui/themes";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Theme
        appearance="dark"
        accentColor="green"
        grayColor="sand"
        radius="small"
        style={{
          minHeight: "100vh",
          ["--default-font-family" as string]:
            "var(--font-sans), system-ui, sans-serif",
        }}
      >
        {children}
        <Toaster theme="dark" position="bottom-right" richColors />
      </Theme>
    </AuthProvider>
  );
}
