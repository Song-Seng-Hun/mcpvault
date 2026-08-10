/**
 * Inline SVG icon helper.
 *
 * The shell components (Nav, Footer, ThemeToggle) never imported
 * `lucide-react` in the Astro source -- their icons were already raw
 * inline `<svg>` markup. This module gives that markup a single audited
 * home so later groups (FeatureGrid, ComparisonTable, InteractiveDemo, etc.)
 * have a runtime-neutral replacement ready when they drop `lucide-react`.
 *
 * All icons are decorative by default (`aria-hidden="true"`) because every
 * call site in the shell already pairs the icon with visible text or an
 * `aria-label` on the interactive parent (button/link). Pass `title` to
 * expose an accessible name instead when an icon is ever used alone.
 */
import type { FC } from "hono/jsx";

export interface IconProps {
  className?: string;
  title?: string;
}

function iconA11yProps(title?: string) {
  return title ? { role: "img", "aria-label": title } : { "aria-hidden": "true" };
}

export const GitHubIcon: FC<IconProps> = ({ className, title }) => (
  <svg class={className} fill="currentColor" viewBox="0 0 24 24" {...iconA11yProps(title)}>
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

export const NpmIcon: FC<IconProps> = ({ className, title }) => (
  <svg class={className} fill="currentColor" viewBox="0 0 24 24" {...iconA11yProps(title)}>
    <path d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0v1.336H8.001V8.667h2.665v5.331zm12 0h-1.334v-4h-1.332v4h-1.336v-4h-1.332v4H12V8.667h10.666v5.331z" />
  </svg>
);

export const MenuIcon: FC<IconProps> = ({ className, title }) => (
  <svg class={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" {...iconA11yProps(title)}>
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

export const SunIcon: FC<IconProps> = ({ className, title }) => (
  <svg class={className} fill="currentColor" viewBox="0 0 20 20" {...iconA11yProps(title)}>
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
    />
  </svg>
);

export const MoonIcon: FC<IconProps> = ({ className, title }) => (
  <svg class={className} fill="currentColor" viewBox="0 0 20 20" {...iconA11yProps(title)}>
    <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
  </svg>
);

/** Stroke defaults matching lucide-react's rendered output (v1.31.0). */
const strokeIconProps = {
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  "stroke-linecap": "round" as const,
  "stroke-linejoin": "round" as const,
};

export const RocketIcon: FC<IconProps> = ({ className, title }) => (
  <svg class={className} viewBox="0 0 24 24" {...strokeIconProps} {...iconA11yProps(title)}>
    <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09" />
    <path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z" />
    <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05" />
  </svg>
);

export const ArrowRightIcon: FC<IconProps> = ({ className, title }) => (
  <svg class={className} viewBox="0 0 24 24" {...strokeIconProps} {...iconA11yProps(title)}>
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

export const GitBranchIcon: FC<IconProps> = ({ className, title }) => (
  <svg class={className} viewBox="0 0 24 24" {...strokeIconProps} {...iconA11yProps(title)}>
    <path d="M15 6a9 9 0 0 0-9 9V3" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
  </svg>
);
