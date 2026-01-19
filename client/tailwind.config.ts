import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Semantic icon sizes
      spacing: {
        'icon-xs': '0.75rem',   // 12px - tiny indicators
        'icon-sm': '1rem',      // 16px - inline icons
        'icon': '1.25rem',      // 20px - standard icons
        'icon-lg': '1.5rem',    // 24px - prominent icons
        'icon-xl': '2rem',      // 32px - large icons
        'icon-2xl': '3rem',     // 48px - hero icons
        'icon-3xl': '4rem',     // 64px - splash icons
      },
      // Button sizes (height and width for square buttons)
      width: {
        'btn-sm': '2rem',       // 32px
        'btn': '2.5rem',        // 40px
        'btn-lg': '2.75rem',    // 44px
      },
      height: {
        'btn-sm': '2rem',       // 32px
        'btn': '2.5rem',        // 40px
        'btn-lg': '2.75rem',    // 44px
        'input': '2.5rem',      // 40px - form inputs
        'input-lg': '2.75rem',  // 44px - larger inputs
      },
      minHeight: {
        'input': '2.5rem',      // 40px
        'input-lg': '2.75rem',  // 44px
      },
      maxHeight: {
        'dropdown': '12rem',    // 192px - autocomplete dropdowns
        'modal-content': '20rem', // 320px - scrollable modal content
      },
      // Font sizes with line heights
      fontSize: {
        'caption': ['0.75rem', { lineHeight: '1rem' }],     // 12px - small labels, hints
        'body-sm': ['0.8125rem', { lineHeight: '1.25rem' }], // 13px - secondary text
        'body': ['0.875rem', { lineHeight: '1.25rem' }],    // 14px - main body text
        'label': ['0.875rem', { lineHeight: '1.25rem' }],   // 14px - form labels
        'title-sm': ['1rem', { lineHeight: '1.5rem' }],     // 16px - small titles
        'title': ['1.125rem', { lineHeight: '1.5rem' }],    // 18px - section titles
        'title-lg': ['1.5rem', { lineHeight: '2rem' }],     // 24px - page titles
      },
      // Border radius
      borderRadius: {
        'control': '0.5rem',     // 8px - buttons, inputs
        'control-sm': '0.375rem', // 6px - small controls
        'card': '0.625rem',      // 10px - cards, modals
        'pill': '9999px',        // full rounded
      },
      // Gaps and padding presets
      gap: {
        'control': '0.5rem',     // 8px - between controls
        'section': '1rem',       // 16px - between sections
      },
      padding: {
        'control': '0.5rem',     // 8px - button padding
        'control-x': '0.75rem',  // 12px - horizontal padding
        'card': '1rem',          // 16px - card padding
        'modal': '1.5rem',       // 24px - modal padding
      },
    },
  },
  plugins: [],
} satisfies Config;
