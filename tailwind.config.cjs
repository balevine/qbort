/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Neo-brutalist monochrome palette. Slate-grey is reserved for staff messages.
        ink: '#000000',
        paper: '#ffffff',
        staff: '#64748b' // slate-500, the one permitted non-pure-monochrome surface
      },
      fontFamily: {
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['"Inter"', 'ui-sans-serif', 'system-ui', 'sans-serif']
      },
      boxShadow: {
        brutal: '4px 4px 0 0 #000000',
        'brutal-sm': '2px 2px 0 0 #000000',
        'brutal-lg': '6px 6px 0 0 #000000'
      },
      borderRadius: {
        // Neo-brutalism uses hard corners.
        none: '0px'
      }
    }
  },
  plugins: []
}
