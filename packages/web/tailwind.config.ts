
import type { Config } from 'tailwindcss'

export default {
  content: [
    './src/**/*.{js,ts,vue,html}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [
    require('tw-animate-css'),
  ],
} satisfies Config
