import { Theme } from "@radix-ui/themes";
import { type RenderOptions, render } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

// Radix Themes components read from the Theme context; wrap every render in it,
// mirroring the app's `<Theme>` in src/app/providers.tsx.
function Wrapper({ children }: { children: ReactNode }) {
  return <Theme appearance="dark">{children}</Theme>;
}

function renderWithTheme(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: Wrapper, ...options });
}

// Re-export the RTL surface so tests import everything from one place.
export * from "@testing-library/react";
export { renderWithTheme as render };
