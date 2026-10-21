/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', '"Microsoft YaHei UI"', '"Microsoft YaHei"', 'system-ui', 'sans-serif'],
        display: ['"Segoe UI Variable Display"', '"Segoe UI"', '"Microsoft YaHei UI"', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Code"', '"Cascadia Mono"', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
