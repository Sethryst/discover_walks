# Anonymous signed attribution / lineage

## Intent

Accountless users should be able to create Geo Cyphers without exposing a name, email address, or account identity. The experience should show **Anonymous** while still allowing the app to prove that a response belongs to the same signed lineage.

## Proposed behavior

- Generate a device signing key on first use; keep the private key local and non-exportable.
- Display `Anonymous` as the creator label when there is no registered identity.
- Keep the public-key fingerprint and signature in the pin manifest so the lineage remains verifiable.
- A response inherits the parent/root lineage and remains attributable to that anonymous lineage without requiring login.
- If a user later creates an account, do not silently rewrite old anonymous pins; offer an explicit opt-in identity association instead.

## Privacy and safety boundaries

- Never derive the visible Anonymous label from a personal identifier.
- Do not expose precise creator location or device identity in the label.
- Support local delete, report, block, and revocation/invalidity states before public publishing.
- A signature proves continuity and integrity, not that content is safe, true, or legally publishable.

## Open decisions

- Whether one device gets one stable anonymous identity or rotates identities periodically.
- Whether anonymous lineage is visible to other users or only used by the service for provenance.
- How a lost device/key should affect old pins and responses.
- Whether an audible/metadata watermark is needed in addition to the signed manifest.
