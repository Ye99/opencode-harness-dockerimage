## Vendored Upstreams

- `vendor/opencode-oca-auth/` is a vendored snapshot of `https://github.com/Ye99/opencode-oca-auth`.
- `https://github.com/Ye99/opencode-oca-auth` is the source of truth.
- Do not patch `vendor/opencode-oca-auth/` directly for real fixes.
- Make fixes in the upstream repo first, then resync `vendor/opencode-oca-auth/` from that repo and update both `vendor/opencode-oca-auth/.source-revision` and `vendor/sources.lock.json`.
