# ADR-0004: Self-hosted authentication with Better Auth

- Status: Proposed
- Date: 2026-10-24

## Context
Requirements: email verification, MFA (OTP), recovery codes, password reset, session management and revocation, invitations, rate limiting; must run on-prem without third-party SaaS; must serve web (cookies) and mobile (tokens). Writing our own crypto/session/OTP logic is explicitly forbidden by project rules.

## Decision
Use **Better Auth** embedded in the API, storing its data in our Postgres.
- Plugins: two-factor (TOTP authenticator apps + backup/recovery codes; email OTP as fallback), organization (memberships/invitations — mapped onto our `tenancy` module), passkeys (optional, later), rate limiting.
- Web: httpOnly, `Secure`, `SameSite=Lax` session cookies scoped to the tenant host + CSRF protection on state-changing requests.
- Mobile: bearer session tokens stored in the OS secure keystore.
- **Minimum version 1.6.11** — CVE-2026-53514 (invitation acceptance by an unverified session). Additionally we require a verified email matching the invitation before acceptance, enforced in our own code too (defence in depth).
- MFA mandatory for roles holding sensitive permissions (payroll, roles, payments, exports); optional-but-encouraged for others; tenant-configurable to "required for all".
- Our `access` module — not the auth library — remains the source of truth for permissions. Auth answers "who are you"; access answers "what may you do here".
- SSO (SAML/OIDC with customers' Azure AD etc.) planned post-MVP — common request from audit/bank clients.

## Consequences
- (+) Self-hosted, no per-user vendor fees, works on-prem.
- (+) Established library rather than custom security code.
- (−) We own patching: dependency scanning and a security-advisory watch are required (in `security.md`).
- (−) Library-specific schema; wrapped behind our `identity` module so it could be replaced.
