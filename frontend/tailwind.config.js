/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Bitta palitra: grafit neytral qatlamlar + bitta urg'u (teal-cyan). Qizil/sariq/yashil faqat holat (xavf/ogohlantirish/xavfsiz) uchun.
      // Eski nomlar (tactical, police) saqlangan, shuning uchun hamma tablar yangi palitrani avtomatik oladi.
      colors: {
        tactical: {
          950: '#0b0e13',
          900: '#10141b',
          850: '#141922',
          800: '#1a202a',
          700: '#252d3a',
          600: '#343e50',
          500: '#4a566b',
        },
        police: {
          blue: '#1f7f95',
          blueGlow: 'rgba(31, 127, 149, 0.35)',
          red: '#ef5b5b',
          redGlow: 'rgba(239, 91, 91, 0.35)',
          cyan: '#5ad1e6',
          amber: '#f5b544',
          green: '#4ade80',
        }
      },
      // Bitta shrift oilasi (Onest, o'zida saqlanadi). Mono ham shu shrift: raqamlar tabular-nums orqali tekislanadi
      fontFamily: {
        sans: ['Onest', 'system-ui', 'sans-serif'],
        mono: ['Onest', 'system-ui', 'sans-serif'],
        display: ['Onest', 'system-ui', 'sans-serif'],
      },
      animation: {
        'strobe-police': 'policeStrobe 0.8s infinite ease-in-out',
        'radar-sweep': 'radarSweep 4s linear infinite',
        'pulse-subtle': 'pulseSubtle 2s infinite ease-in-out',
      },
      keyframes: {
        policeStrobe: {
          '0%, 45%': { borderColor: '#ef5b5b' },
          '50%, 95%': { borderColor: '#1f7f95' },
          '100%': { borderColor: '#ef5b5b' },
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
