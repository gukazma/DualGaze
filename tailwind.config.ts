import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
    },
    extend: {
      colors: {
        // 对齐 pencil 原型色板
        bg: {
          DEFAULT: '#0c0d10',
          surface: '#0f1218',
          panel: '#131720',
          input: '#1a1d24',
        },
        border: {
          DEFAULT: '#2f3548',
          subtle: '#1f2330',
        },
        text: {
          primary: '#e8e8e8',
          secondary: '#aab0c0',
          muted: '#6b7280',
        },
        accent: {
          DEFAULT: '#ffd24a',        // primary 黄
          'cyan': '#00d2c0',         // FPV / 模拟 青
          'danger': '#e57373',
          'success': '#7cc78a',
        },
        // v3.3 OV 用：采样/视角热图 + 状态 badge 配色
        mint: '#4ade80',             // 完成 / 已配置 绿
        violet: '#a78bfa',           // 障碍物 紫
        // shadcn 标准命名 (主题切换 / 兼容)
        background: '#0c0d10',
        foreground: '#e8e8e8',
        card: { DEFAULT: '#131720', foreground: '#e8e8e8' },
        popover: { DEFAULT: '#131720', foreground: '#e8e8e8' },
        primary: { DEFAULT: '#ffd24a', foreground: '#0c0d10' },
        secondary: { DEFAULT: '#1a1d24', foreground: '#e8e8e8' },
        muted: { DEFAULT: '#1a1d24', foreground: '#aab0c0' },
        destructive: { DEFAULT: '#e57373', foreground: '#0c0d10' },
        input: '#1a1d24',
        ring: '#ffd24a',
      },
      borderRadius: {
        lg: '8px',
        md: '6px',
        sm: '4px',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
};

export default config;
