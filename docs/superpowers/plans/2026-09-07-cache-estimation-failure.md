# Cache Estimation Failure Plan

- [ ] Reproduce unit and real metadata-cache failures with tests before edits.
- [ ] Serialize once; return Infinity for missing representation or exceptions.
- [ ] Verify cache rejection preserves result and row accounting, then recovers.
- [ ] Document limits; build; independent bounded review; full one-worker suite.
- [ ] Commit explicit source/test/docs/dist changes and push fork main only.

No live Vault changes, GPU/model work, client installation, or upstream PRs.
