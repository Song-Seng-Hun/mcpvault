/**
 * Site navigation. Ported from Nav.astro.
 *
 * Active-link highlighting was client JS in Astro (`updateActiveNav`,
 * comparing `window.location.pathname`); here it is computed server-side
 * from `currentPath`, which every request already has, so it works with
 * no JavaScript and needs no hydration.
 *
 * The mobile menu button/panel markup is ported, but stays a static
 * (non-interactive) `[hidden]` panel until Phase 3 wires an Alpine
 * `Alpine.data()` module to it -- matching the plan's rule that mobile nav
 * state is Alpine's job, not vanilla inline scripts.
 */
import { BrandMark } from "./BrandMark";
import { GitHubIcon, MenuIcon } from "./icons";

export interface NavLink {
  href: string;
  label: string;
  isNew?: boolean;
}

export const NAV_LINKS: NavLink[] = [
  { href: "/install", label: "Install" },
  { href: "/features", label: "Features" },
  { href: "/demo", label: "Demo" },
  { href: "/how-it-works", label: "How It Works" },
  { href: "/skill", label: "Skill" },
];

export interface NavProps {
  currentPath: string;
  version: string;
}

function isActive(currentPath: string, href: string): boolean {
  const normalized = currentPath.replace(/\/$/, "") || "/";
  return normalized === href;
}

export function Nav({ currentPath, version }: NavProps) {
  return (
    <nav data-component="nav">
      <div class="nav-inner">
        <div class="nav-row">
          <a href="/" class="logo-link">
            <span class="logo-icon">
              <BrandMark idSuffix="logo" />
            </span>
            <span class="logo-text">MCPVault</span>
            <span class="version-badge">v{version}</span>
          </a>

          <div class="nav-links">
            {NAV_LINKS.map((link) => (
              <a href={link.href} class={`nav-link${isActive(currentPath, link.href) ? " nav-link-active" : ""}`}>
                <span class="nav-link-label">
                  {link.label}
                  {link.isNew ? <span class="nav-badge-new">NEW</span> : null}
                </span>
              </a>
            ))}
            <a href="https://github.com/bitbonsai/mcpvault" target="_blank" rel="noopener noreferrer" class="nav-link nav-icon-link">
              <GitHubIcon className="icon" />
              GitHub
            </a>
          </div>

          <button class="mobile-menu-button" id="mobile-menu-button" aria-label="Toggle mobile menu" aria-expanded="false" aria-controls="mobile-menu">
            <MenuIcon className="icon" />
          </button>
        </div>
      </div>

      <div class="mobile-menu" id="mobile-menu" hidden>
        <div class="mobile-menu-inner">
          {NAV_LINKS.map((link) => (
            <a href={link.href} class={`nav-link${isActive(currentPath, link.href) ? " nav-link-active" : ""}`}>
              <span class="nav-link-label">
                {link.label}
                {link.isNew ? <span class="nav-badge-new">NEW</span> : null}
              </span>
            </a>
          ))}
          <a href="https://github.com/bitbonsai/mcpvault" target="_blank" rel="noopener noreferrer" class="nav-link nav-icon-link">
            <GitHubIcon className="icon" />
            GitHub
          </a>
        </div>
      </div>
    </nav>
  );
}
