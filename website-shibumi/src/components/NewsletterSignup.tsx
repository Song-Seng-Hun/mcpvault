/**
 * Newsletter signup card. Ported from NewsletterSignup.astro.
 *
 * Submission state (Phase 3) is the `newsletterSignup` Alpine.data()
 * module (`../client/newsletter.ts`): the form names it with `x-data`,
 * binds the email input with `x-model="email"`, intercepts submit with
 * `x-on:submit.prevent="submit()"`, and reflects `status` on the button
 * label/disabled state and the success/error banners. The form still has
 * a real `action`/`method`, and the input keeps `name="email"`, so it
 * degrades to a normal (if unstyled-response) POST with no JavaScript,
 * rather than doing nothing on submit -- see `newsletter.ts` for why the
 * banners bind `hidden` directly instead of a `.hidden` class.
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
              <form method="post" action="/api/subscribe" data-newsletter-form x-data="newsletterSignup" {...{ "x-on:submit.prevent": "submit()" }}>
                <label for="newsletter-email">Email address</label>
                <div class="form-row">
                  <input id="newsletter-email" type="email" name="email" placeholder="you@vaults.dev" required x-model="email" />
                  <button type="submit" x-bind:disabled="status === 'submitting'" x-text="status === 'submitting' ? 'Adding…' : 'Join the list'">
                    Join the list
                  </button>
                </div>
                <p class="form-hint">
                  Powered by{" "}
                  <a href="https://resend.com" target="_blank" rel="noopener">
                    Resend
                  </a>
                  . Never more than once a week.
                </p>
                <p class="form-success" hidden data-newsletter-success x-bind:hidden="status !== 'success'">
                  You're on the list. We'll send the next release update straight to your inbox.
                </p>
                <p class="form-error" hidden data-newsletter-error x-bind:hidden="status !== 'error'">
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
