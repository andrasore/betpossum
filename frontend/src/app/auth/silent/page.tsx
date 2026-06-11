"use client";

import { useEffect } from "react";
import { silentCallback } from "@/lib/auth";

// Loaded only inside the hidden silent-renew iframe. It hands the prompt=none
// response back to the parent window's UserManager and renders nothing — the
// AuthProvider bootstrap is suppressed on this path (see auth-context.tsx).
export default function SilentCallbackPage() {
  useEffect(() => {
    void silentCallback();
  }, []);
  return null;
}
