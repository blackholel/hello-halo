/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/renderer/**/*.{js,ts,jsx,tsx,html}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Kite brand colors
        'kite-glow': 'hsl(var(--kite-glow))',
        'kite-success': 'hsl(var(--kite-success))',
        'kite-warning': 'hsl(var(--kite-warning))',
        'kite-error': 'hsl(var(--kite-error))',
      },
      borderRadius: {
        '2xl': '14px',
        '3xl': '9999px',
        lg: 'var(--radius)',
        md: '12px',
        sm: '8px',
      },
      boxShadow: {
        'glass': '0 1px 3px rgba(18, 23, 33, 0.06)',
        'glass-lg': '0 3px 10px rgba(18, 23, 33, 0.08)',
        'glass-hover': '0 4px 12px rgba(18, 23, 33, 0.1)',
        'glow': '0 0 0 rgba(0, 0, 0, 0)',
        'glow-lg': '0 0 0 rgba(0, 0, 0, 0)',
        'soft': '0 1px 3px rgba(18, 23, 33, 0.08)',
        'elevated': '0 2px 8px rgba(18, 23, 33, 0.1)',
      },
      backdropBlur: {
        'glass': '20px',
        'glass-lg': '40px',
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 4s ease-in-out infinite',
        'ambient-shift': 'ambient-shift 20s ease-in-out infinite',
      },
      keyframes: {
        'float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-2px)' },
        },
        'glow-pulse': {
          '0%, 100%': { opacity: '0.25' },
          '50%': { opacity: '0.45' },
        },
        'ambient-shift': {
          '0%': { transform: 'translate(0%, 0%)' },
          '50%': { transform: 'translate(-1.5%, 1.5%)' },
          '100%': { transform: 'translate(0%, 0%)' },
        },
      },
    },
  },
  plugins: [],
}
