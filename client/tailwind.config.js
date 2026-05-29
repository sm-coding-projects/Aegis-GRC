/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        serif: ['"IBM Plex Serif"', 'Georgia', 'serif'],
      },
      // Tokens are HSL CSS variables (see styles/tokens.css) so light/dark is a
      // variable swap, never a re-skin. Components reference these, never raw hex.
      colors: {
        bg: 'hsl(var(--bg))',
        surface: 'hsl(var(--surface))',
        'surface-2': 'hsl(var(--surface-2))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        text: 'hsl(var(--text))',
        'text-muted': 'hsl(var(--text-muted))',
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          fg: 'hsl(var(--accent-fg))',
          hover: 'hsl(var(--accent-hover))',
        },
        status: {
          implemented: 'hsl(var(--status-implemented))',
          'implemented-bg': 'hsl(var(--status-implemented-bg))',
          progress: 'hsl(var(--status-progress))',
          'progress-bg': 'hsl(var(--status-progress-bg))',
          notstarted: 'hsl(var(--status-notstarted))',
          'notstarted-bg': 'hsl(var(--status-notstarted-bg))',
          na: 'hsl(var(--status-na))',
          'na-bg': 'hsl(var(--status-na-bg))',
          overdue: 'hsl(var(--status-overdue))',
          'overdue-bg': 'hsl(var(--status-overdue-bg))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          fg: 'hsl(var(--destructive-fg))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      spacing: {
        // 4px base, 8px rhythm (§7.3)
        1: '4px',
        2: '8px',
        3: '12px',
        4: '16px',
        6: '24px',
        8: '32px',
        12: '48px',
        16: '64px',
      },
      fontSize: {
        // §7.1 type scale (rem)
        xs: ['0.75rem', { lineHeight: '1.5' }],
        sm: ['0.875rem', { lineHeight: '1.5' }],
        base: ['1rem', { lineHeight: '1.5' }],
        lg: ['1.125rem', { lineHeight: '1.4' }],
        xl: ['1.25rem', { lineHeight: '1.3' }],
        '2xl': ['1.5rem', { lineHeight: '1.25' }],
        '3xl': ['1.875rem', { lineHeight: '1.15' }],
        '4xl': ['2.25rem', { lineHeight: '1.1' }],
      },
      boxShadow: {
        'elev-1': 'var(--elev-1)',
        'elev-2': 'var(--elev-2)',
        'elev-3': 'var(--elev-3)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-out-right': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
        'overlay-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-in-right': 'slide-in-right 200ms ease-out',
        'slide-out-right': 'slide-out-right 150ms ease-in',
        'overlay-in': 'overlay-in 150ms ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
