/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: 'class',
  // Safelist for colorMap.js dynamic class references
  safelist: [
    {
      pattern: /^(bg|text|border)-(honey|terra|sage|lavender|hearth|accent)-(50|100|200|300|400|500|600|700|800|850|900|950)/,
      variants: ['dark'],
    },
  ],
  theme: {
    extend: {
      // ============================================
      // Hearthside Design System — Color Palette
      // ============================================
      colors: {
        // Core Surface Colors
        // Dark mode uses warm-tinted surfaces, NOT pure black.
        // hearth-950 is the darkest background. Do not add #000000.
        // Rationale: therapeutic warmth > OLED battery savings.
        hearth: {
          50:  '#FAF5EF',  // Linen cream (light bg)
          100: '#F5EDE3',  // Warm parchment
          200: '#E8DDD0',  // Sand
          300: '#D4C4B0',  // Driftwood
          400: '#B8A48E',  // Weathered oak
          500: '#8E7A66',  // Warm stone
          600: '#6B5A4A',  // Bark
          700: '#4A3D32',  // Deep bark
          800: '#2A2420',  // Toasted brown (dark surface)
          850: '#231D1B',  // Dark mode raised surface
          900: '#1C1916',  // Deep charcoal (dark bg)
          950: '#131110',  // Deepest dark
        },

        // Primary — Honey Amber (warmth, invitation)
        honey: {
          50:  '#FFF8EB',
          100: '#FEECC8',
          200: '#FDDB8C',
          300: '#FCC44F',
          400: '#E8A84C',
          500: '#D4922E',
          600: '#B87A1E',
          700: '#925D17',
          800: '#6E4512',
          900: '#4A2E0D',
        },

        // Emotional Warmth — Terracotta (grounding, earth)
        terra: {
          50:  '#FDF2EF',
          100: '#FADDD5',
          200: '#F4BAA8',
          300: '#E89680',
          400: '#C4725A',
          500: '#B8654E',
          600: '#9E5040',
          700: '#7D3D32',
          800: '#5E2D24',
          900: '#3F1E18',
        },

        // Growth — Sage Green (progress, nature)
        sage: {
          50:  '#F2F7F3',
          100: '#E0ECE2',
          200: '#C1D9C5',
          300: '#9DC0A3',
          400: '#7A9E7E',
          500: '#5A7E5E',
          600: '#476549',
          700: '#364D38',
          800: '#253527',
          900: '#1A241B',
        },

        // Calm/Reflection — Dusty Lavender
        lavender: {
          50:  '#F5F3F9',
          100: '#E8E3F2',
          200: '#D1C8E5',
          300: '#B5A7D4',
          400: '#9B8EC4',
          500: '#7B6EA4',
          600: '#635887',
          700: '#4C4368',
          800: '#352F49',
          900: '#221E30',
        },

        // Mood Colors (Entry-level indicators)
        mood: {
          great:      '#7A9E7E',  // Sage green
          good:       '#9DC0A3',  // Light sage
          neutral:    '#E8A84C',  // Honey amber
          low:        '#9B8EC4',  // Dusty lavender
          struggling: '#C4725A',  // Terracotta
        },

        // Ambient Mood Colors (Background gradients)
        ambient: {
          warm: {
            from: '#E8A84C',
            via:  '#7A9E7E',
            to:   '#C1D9C5',
          },
          'warm-dark': {
            from: 'rgba(110, 69, 18, 0.4)',
            via:  'rgba(37, 53, 39, 0.3)',
            to:   'rgba(37, 53, 39, 0.2)',
          },
          balanced: {
            from: '#D4C4B0',
            via:  '#E8DDD0',
            to:   '#F5EDE3',
          },
          'balanced-dark': {
            from: 'rgba(42, 36, 32, 0.6)',
            via:  'rgba(35, 29, 27, 0.5)',
            to:   'rgba(28, 25, 22, 0.4)',
          },
          calm: {
            from: '#9B8EC4',
            via:  '#B5A7D4',
            to:   '#D1C8E5',
          },
          'calm-dark': {
            from: 'rgba(53, 47, 73, 0.4)',
            via:  'rgba(53, 47, 73, 0.3)',
            to:   'rgba(34, 30, 48, 0.3)',
          },
        },

        // Accent — Sunset Rose (gentle emphasis)
        accent: {
          DEFAULT: '#D4918C',
          light:   '#F0D0CC',
          dark:    '#B8706A',
        },

        // Legacy compatibility aliases
        primary: {
          50:  '#F2F7F3',
          100: '#E0ECE2',
          200: '#C1D9C5',
          300: '#9DC0A3',
          400: '#7A9E7E',
          500: '#5A7E5E',
          600: '#476549',
          700: '#364D38',
          800: '#253527',
          900: '#1A241B',
        },
        secondary: {
          50:  '#F5F3F9',
          100: '#E8E3F2',
          200: '#D1C8E5',
          300: '#B5A7D4',
          400: '#9B8EC4',
          500: '#7B6EA4',
          600: '#635887',
          700: '#4C4368',
          800: '#352F49',
          900: '#221E30',
        },
        warm: {
          50:  '#FAF5EF',
          100: '#F5EDE3',
          200: '#E8DDD0',
          300: '#D4C4B0',
          400: '#B8A48E',
          500: '#8E7A66',
          600: '#6B5A4A',
          700: '#4A3D32',
          800: '#2A2420',
          900: '#1C1916',
        },
      },

      // ============================================
      // Typography
      // ============================================
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        body:    ['DM Sans', 'system-ui', 'sans-serif'],
        hand:    ['Caveat', 'cursive'],
      },

      fontSize: {
        'display-xl': ['2.75rem', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '600' }],
        'display-lg': ['2rem',    { lineHeight: '1.15', letterSpacing: '-0.015em', fontWeight: '600' }],
        'display-md': ['1.5rem',  { lineHeight: '1.2', letterSpacing: '-0.01em', fontWeight: '500' }],
        'display-sm': ['1.25rem', { lineHeight: '1.3', letterSpacing: '-0.005em', fontWeight: '500' }],
        'hand-lg':    ['1.5rem',  { lineHeight: '1.4', fontWeight: '400' }],
        'hand-md':    ['1.25rem', { lineHeight: '1.4', fontWeight: '400' }],
      },

      // ============================================
      // Animations
      // ============================================
      animation: {
        'fade-in':       'fadeIn 0.3s ease-out',
        'fade-in-up':    'fadeInUp 0.4s ease-out',
        'slide-up':      'slideUp 0.4s ease-out',
        'slide-down':    'slideDown 0.3s ease-out',
        'scale-in':      'scaleIn 0.2s ease-out',
        'bounce-gentle': 'bounceGentle 0.6s ease-out',
        'pulse-soft':    'pulseSoft 2s ease-in-out infinite',
        'float':         'float 3s ease-in-out infinite',
        'breathe':       'breathe 4s ease-in-out infinite',
        'shimmer':       'shimmer 2s linear infinite',
        'glow':          'glow 2s ease-in-out infinite',
        'shake':         'shake 0.5s ease-in-out infinite',
        'sparkle':       'sparkle 2s ease-in-out infinite',
        // Hearthside additions
        'ember':         'ember 3s ease-in-out infinite',
        'warmth':        'warmth 6s ease-in-out infinite',
        'unfurl':        'unfurl 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%':   { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%':   { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%':   { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%':   { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        bounceGentle: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%':      { transform: 'scale(1.05)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.7' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-10px)' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.8' },
          '50%':      { transform: 'scale(1.1)', opacity: '1' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        glow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(232, 168, 76, 0.2)' },
          '50%':      { boxShadow: '0 0 30px rgba(232, 168, 76, 0.4)' },
        },
        shake: {
          '0%, 100%': { transform: 'rotate(-1deg)' },
          '50%':      { transform: 'rotate(1deg)' },
        },
        sparkle: {
          '0%, 100%': { opacity: '0.8', transform: 'scale(1)' },
          '50%':      { opacity: '1', transform: 'scale(1.1)' },
        },
        // Hearthside — warm ember glow pulse
        ember: {
          '0%, 100%': { boxShadow: '0 0 15px rgba(232, 168, 76, 0.15)' },
          '50%':      { boxShadow: '0 0 25px rgba(196, 114, 90, 0.25)' },
        },
        // Hearthside — slow background warmth shift
        warmth: {
          '0%, 100%': { filter: 'hue-rotate(0deg) brightness(1)' },
          '50%':      { filter: 'hue-rotate(5deg) brightness(1.02)' },
        },
        // Hearthside — card unfurl from nothing
        unfurl: {
          '0%':   { opacity: '0', transform: 'scale(0.9) translateY(8px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
      },

      // ============================================
      // Shadows — Warm-tinted
      // ============================================
      boxShadow: {
        'soft':       '0 2px 15px -3px rgba(42, 36, 32, 0.08), 0 10px 20px -2px rgba(42, 36, 32, 0.04)',
        'soft-md':    '0 4px 20px -4px rgba(42, 36, 32, 0.1), 0 8px 16px -4px rgba(42, 36, 32, 0.06)',
        'soft-lg':    '0 10px 40px -10px rgba(42, 36, 32, 0.12), 0 20px 25px -10px rgba(42, 36, 32, 0.08)',
        'soft-xl':    '0 20px 50px -15px rgba(42, 36, 32, 0.15)',
        'glow':       '0 0 20px rgba(232, 168, 76, 0.2)',
        'glow-lg':    '0 0 30px rgba(232, 168, 76, 0.3)',
        'glow-terra': '0 0 20px rgba(196, 114, 90, 0.2)',
        'glow-sage':  '0 0 20px rgba(122, 158, 126, 0.2)',
        'inner-soft': 'inset 0 2px 4px 0 rgba(42, 36, 32, 0.06)',
        'glass-sm':   '0 4px 6px -1px rgba(28, 25, 22, 0.1), 0 2px 4px -1px rgba(28, 25, 22, 0.06)',
        'glass-md':   '0 8px 30px rgba(28, 25, 22, 0.12)',
        'glass-lg':   '0 12px 40px rgba(28, 25, 22, 0.15)',
        // Dark mode warm shadows
        'dark-soft':    '0 2px 15px -3px rgba(0, 0, 0, 0.3), 0 10px 20px -2px rgba(0, 0, 0, 0.2)',
        'dark-soft-md': '0 4px 20px -4px rgba(0, 0, 0, 0.4), 0 8px 16px -4px rgba(0, 0, 0, 0.25)',
        'dark-glow':    '0 0 20px rgba(232, 168, 76, 0.15)',
      },

      // ============================================
      // Border Radius
      // ============================================
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },

      // ============================================
      // Backdrop Blur
      // ============================================
      backdropBlur: {
        xs: '2px',
      },

      // ============================================
      // Transitions
      // ============================================
      transitionDuration: {
        '400': '400ms',
      },

      // ============================================
      // Spacing
      // ============================================
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },

      // ============================================
      // Gradient Presets — Light/Dark pairs
      // ============================================
      gradientPresets: {
        'hearth-glow': {
          light: { from: '#FCC44F', to: '#C4725A' },
          dark: { from: 'rgba(110, 69, 18, 0.6)', to: 'rgba(94, 45, 36, 0.6)' },
        },
        'sage-mist': {
          light: { from: '#E0ECE2', to: '#9DC0A3' },
          dark: { from: 'rgba(26, 36, 27, 0.4)', to: 'rgba(37, 53, 39, 0.4)' },
        },
        'lavender-dusk': {
          light: { from: '#E8E3F2', to: '#B5A7D4' },
          dark: { from: 'rgba(34, 30, 48, 0.4)', to: 'rgba(53, 47, 73, 0.4)' },
        },
        'terra-dawn': {
          light: { from: '#FADDD5', to: '#FEECC8' },
          dark: { from: 'rgba(63, 30, 24, 0.4)', to: 'rgba(74, 46, 13, 0.4)' },
        },
        'hearth-surface': {
          light: { from: '#FAF5EF', to: '#FFFFFF' },
          dark: { from: '#1C1916', to: '#231D1B' },
        },
      },
    },
  },
  plugins: [],
}
