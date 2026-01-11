/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      // Therapeutic Color Palette
      colors: {
        // Primary - Calming Teal/Sage
        primary: {
          50: '#f0fdf9',
          100: '#ccfbef',
          200: '#99f6e0',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
        },
        // Secondary - Warm Lavender
        secondary: {
          50: '#faf5ff',
          100: '#f3e8ff',
          200: '#e9d5ff',
          300: '#d8b4fe',
          400: '#c084fc',
          500: '#a855f7',
          600: '#9333ea',
          700: '#7c3aed',
          800: '#6b21a8',
          900: '#581c87',
        },
        // Warm Neutrals (instead of cold gray)
        warm: {
          50: '#fafaf9',
          100: '#f5f5f4',
          200: '#e7e5e4',
          300: '#d6d3d1',
          400: '#a8a29e',
          500: '#78716c',
          600: '#57534e',
          700: '#44403c',
          800: '#292524',
          900: '#1c1917',
        },
        // Mood Colors (Entry-level)
        mood: {
          great: '#10b981',
          good: '#6ee7b7',
          neutral: '#fcd34d',
          low: '#93c5fd',
          struggling: '#a5b4fc',
        },
        // Ambient Mood Colors (Background gradients)
        ambient: {
          // Great/Good → Warm Ambers / Soft Teals
          warm: {
            from: '#fcd9a1',    // Warm amber
            via: '#99f6e0',     // Soft teal
            to: '#d1fae5',      // Emerald tint
          },
          // Neutral → Balanced Grays / Light Blues
          balanced: {
            from: '#e2e8f0',    // Slate gray
            via: '#dbeafe',     // Light blue
            to: '#f1f5f9',      // Gray tint
          },
          // Low/Struggling → Calm Deep Blues / Soft Purples
          calm: {
            from: '#bfdbfe',    // Blue
            via: '#c7d2fe',     // Indigo
            to: '#ddd6fe',      // Purple tint
          },
        },
        // Accent - Sunrise Orange (hope, warmth)
        accent: {
          DEFAULT: '#fb923c',
          light: '#fed7aa',
          dark: '#ea580c',
        },
      },
      // Font Families
      fontFamily: {
        display: ['Nunito', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
      // Animations
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'fade-in-up': 'fadeInUp 0.4s ease-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'slide-down': 'slideDown 0.3s ease-out',
        'scale-in': 'scaleIn 0.2s ease-out',
        'bounce-gentle': 'bounceGentle 0.6s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'breathe': 'breathe 4s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'glow': 'glow 2s ease-in-out infinite',
        // Edit mode animations
        'shake': 'shake 0.5s ease-in-out infinite',
        'sparkle': 'sparkle 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '0', transform: 'translateY(-10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        bounceGentle: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        breathe: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.8' },
          '50%': { transform: 'scale(1.1)', opacity: '1' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        glow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(20, 184, 166, 0.3)' },
          '50%': { boxShadow: '0 0 30px rgba(20, 184, 166, 0.5)' },
        },
        // Edit mode shake animation
        shake: {
          '0%, 100%': { transform: 'rotate(-1deg)' },
          '50%': { transform: 'rotate(1deg)' },
        },
        // Companion nudge sparkle animation
        sparkle: {
          '0%, 100%': { opacity: '0.8', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.1)' },
        },
      },
      // Enhanced Shadows
      boxShadow: {
        'soft': '0 2px 15px -3px rgba(0, 0, 0, 0.07), 0 10px 20px -2px rgba(0, 0, 0, 0.04)',
        'soft-md': '0 4px 20px -4px rgba(0, 0, 0, 0.1), 0 8px 16px -4px rgba(0, 0, 0, 0.06)',
        'soft-lg': '0 10px 40px -10px rgba(0, 0, 0, 0.12), 0 20px 25px -10px rgba(0, 0, 0, 0.08)',
        'soft-xl': '0 20px 50px -15px rgba(0, 0, 0, 0.15)',
        'glow': '0 0 20px rgba(20, 184, 166, 0.3)',
        'glow-lg': '0 0 30px rgba(20, 184, 166, 0.4)',
        'glow-accent': '0 0 20px rgba(251, 146, 60, 0.3)',
        'inner-soft': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
        // Glassmorphism shadows
        'glass-sm': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        'glass-md': '0 8px 30px rgba(0, 0, 0, 0.12)',
        'glass-lg': '0 12px 40px rgba(0, 0, 0, 0.15)',
      },
      // Larger Border Radius
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      // Backdrop Blur
      backdropBlur: {
        xs: '2px',
      },
      // Transitions
      transitionDuration: {
        '400': '400ms',
      },
      // Spacing for rhythm
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
    },
  },
  plugins: [],
}
