import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react";

const config = defineConfig({
  globalCss: {
    html: {
      colorPalette: "brand", // sets the default for everything
    },
  },
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: "#F3E7F6" },
          100: { value: "#E8CFED" },
          200: { value: "#D39EDC" },
          300: { value: "#C070CC" },
          400: { value: "#94509E" },
          500: { value: "#67366E" },
          600: { value: "#552B5B" },
          700: { value: "#432148" },
          800: { value: "#2F1633" },
          900: { value: "#1F0C21" },
          950: { value: "#140616" },
        },
      },
    },
    semanticTokens: {
      colors: {
        brand: {
          solid: { value: "{colors.brand.500}" },
          contrast: { value: "{colors.brand.100}" },
          fg: { value: "{colors.brand.700}" },
          muted: { value: "{colors.brand.100}" },
          subtle: { value: "{colors.brand.200}" },
          emphasized: { value: "{colors.brand.300}" },
          focusRing: { value: "{colors.brand.500}" },
        },
      },
    },
  },
});

export const system = createSystem(defaultConfig, config);
