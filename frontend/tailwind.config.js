/** @type {import('tailwindcss').Config} */
export default {
  // Dark mode is toggled via the `dark` class on <html> (see src/lib/theme.ts),
  // not the default `media` strategy, so users can override the OS preference.
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // Semantic colour tokens backed by CSS variables defined in src/index.css.
      // Using the `rgb(var(--..) / <alpha-value>)` form keeps Tailwind opacity
      // modifiers (e.g. `bg-surface/80`) working. Components can migrate hard-coded
      // white/slate/gray classes to these over time.
      colors: {
        bg: 'rgb(var(--color-bg) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        text: 'rgb(var(--color-text) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        border: 'rgb(var(--color-border) / <alpha-value>)',
        primary: 'rgb(var(--color-primary) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
      },
    },
  },
  plugins: [],
};
