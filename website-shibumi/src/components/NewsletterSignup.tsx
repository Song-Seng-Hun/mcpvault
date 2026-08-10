/**
 * Newsletter signup card. Ported from NewsletterSignup.astro.
 *
 * Markup only for this group -- the fetch-based submit handler
 * (`astro:page-load` listener posting to `/api/subscribe`) is vanilla
 * submission state and becomes a named Alpine.data() module in Phase 3,
 * per the plan. The form still has a real `action`/`method` so it degrades
 * to a normal (if unstyled-response) POST with no JavaScript, rather than
 * doing nothing on submit.
 */
const HIGHLIGHTS = ["Release announcements before they hit npm", "Deep dives on new MCP client integrations", "Security tips for running MCPVault in production"];

export function NewsletterSignup() {
  return (
    <section data-component="newsletter-signup">
      <div class="newsletter-inner">
        <div class="newsletter-card">
          <div class="newsletter-grid">
            <div>
              <p class="eyebrow">Stay in the loop</p>
              <h2>Ship updates to your inbox</h2>
              <p class="lede">Get a lightweight email whenever MCPVault ships a new release, adds a client configuration, or shares Obsidian automation recipes.</p>
              <ul class="highlights">
                {HIGHLIGHTS.map((item) => (
                  <li>
                    <span class="check" aria-hidden="true">
                      ✓
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div class="form-panel">
              <form method="post" action="/api/subscribe" data-newsletter-form>
                <label for="newsletter-email">Email address</label>
                <div class="form-row">
                  <input id="newsletter-email" type="email" name="email" placeholder="you@vaults.dev" required />
                  <button type="submit">Join the list</button>
                </div>
                <p class="form-hint">
                  Powered by{" "}
                  <a href="https://resend.com" target="_blank" rel="noopener">
                    Resend
                  </a>
                  . Never more than once a week.
                </p>
                <p class="form-success" hidden data-newsletter-success>
                  You're on the list. We'll send the next release update straight to your inbox.
                </p>
                <p class="form-error" hidden data-newsletter-error>
                  Something went wrong. Please try again in a minute.
                </p>
              </form>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
