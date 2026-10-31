/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        tactical: {
          950: '#06090e',
          900: '#0a0f18',
          850: '#0e1524',
          800: '#141d30',
          700: '#1d2a44',
          600: '#2b3c5e',
          500: '#3d527d',
        },
        police: {
          blue: '#1d63ff',
          blueGlow: 'rgba(29, 99, 255, 0.4)',
          red: '#ff2238',
          redGlow: 'rgba(255, 34, 56, 0.4)',
          cyan: '#00e5ff',
          amber: '#ffb300',
          green: '#00e676',
        }
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'strobe-police': 'policeStrobe 0.8s infinite ease-in-out',
        'radar-sweep': 'radarSweep 4s linear infinite',
        'pulse-subtle': 'pulseSubtle 2s infinite ease-in-out',
      },
      keyframes: {
        policeStrobe: {
          '0%, 45%': { borderColor: '#ff2238', boxShadow: '0 0 25px rgba(255, 34, 56, 0.8)' },
          '50%, 95%': { borderColor: '#1d63ff', boxShadow: '0 0 25px rgba(29, 99, 255, 0.8)' },
          '100%': { borderColor: '#ff2238', boxShadow: '0 0 25px rgba(255, 34, 56, 0.8)' },
        },
        radarSweep: {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        pulseSubtle: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        }
      }
    },
  },
  plugins: [],
}
