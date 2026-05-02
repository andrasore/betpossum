import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#1a56db', dark: '#1e429f' },
      },
    },
  },
  plugins: [],
};

export default config;
