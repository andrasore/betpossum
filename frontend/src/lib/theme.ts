import {
  createSystem,
  defaultConfig,
  defineConfig,
  defineRecipe,
} from "@chakra-ui/react";

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        brand: {
          50: { value: "#EEEDFE" },
          100: { value: "#CECBF6" },
          200: { value: "#AFA9EC" },
          400: { value: "#7F77DD" },
          600: { value: "#534AB7" },
          800: { value: "#3C3489" },
          900: { value: "#26215C" },
        },
        success: {
          100: { value: "#9FE1CB" },
          200: { value: "#5DCAA5" },
          400: { value: "#1D9E75" },
          600: { value: "#0F6E56" },
        },
        accent: {
          100: { value: "#F4C0D1" },
          200: { value: "#ED93B1" },
          400: { value: "#D4537E" },
          600: { value: "#993556" },
        },
        bg: {
          page: { value: "#0D0B18" }, // deep black for page
          app: { value: "#080610" }, // near-black app background
          card: { value: "#2a2044" }, // visible purple card bg
          border: { value: "#534AB7" }, // brand.600 purple borders
        },
      },
    },
    semanticTokens: {
      colors: {
        "chakra-body-bg": { value: "{colors.bg.app}" },
        "chakra-body-text": { value: "{colors.brand.100}" },
      },
    },
    recipes: {
      button: defineRecipe({
        base: {
          borderRadius: "md",
          fontWeight: "500",
          cursor: "pointer",
        },
        variants: {
          variant: {
            solid: {
              bg: "brand.600",
              color: "brand.50",
              _hover: { bg: "brand.800" },
              _active: { bg: "brand.900" },
            },
            ghost: {
              color: "brand.200",
              bg: "transparent",
              _hover: { bg: "bg.card" },
            },
            live: {
              bg: "accent.200",
              color: "accent.600",
              fontSize: "xs",
              borderRadius: "full",
              px: "3",
              py: "1",
            },
          },
        },
        defaultVariants: {
          variant: "solid",
        },
      }),
      badge: defineRecipe({
        base: {
          borderRadius: "full",
          px: "2",
          py: "0.5",
          fontSize: "xs",
          fontWeight: "500",
        },
        variants: {
          variant: {
            live: {
              bg: "accent.200",
              color: "accent.600",
            },
            hot: {
              bg: "brand.200",
              color: "brand.900",
            },
            win: {
              bg: "success.200",
              color: "success.600",
            },
          },
        },
      }),
    },
  },
  globalCss: {
    body: {
      bg: "bg.app",
      color: "brand.100",
    },
  },
});

export const system = createSystem(defaultConfig, config);
