# ADR-0005: Money, currency, hours and time representation

- Status: Proposed
- Date: 2026-10-24

## Money
- **Never** JavaScript `number` (floating point) for money. In TypeScript, money is a `Money { amount: Decimal; currency: CurrencyCode }` value object (decimal library, e.g. `decimal.js`), living in `packages/domain`.
- Database: `numeric(20,3)` for amounts plus a `currency char(3)` column. Scale 3 is required for KWD (1 KWD = 1000 fils) and also covers 2-decimal (USD, EUR) and 0-decimal currencies.
- A `currencies` reference table stores the ISO 4217 minor-unit exponent; values are rounded to the currency's exponent at defined points only.
- Rounding: **half-up** (commercial) by default, applied per line item then summed — documented and tested per module. Payroll rounding rules are configurable per pay rule set (Phase 11) and must be confirmed against Kuwaiti practice.
- Exchange rates (when multi-currency invoicing arrives) are stored with the transaction, never recomputed later.
- API transmits money as **strings** (`"1250.500"`), never JSON numbers.

## Hours
- Stored as `numeric(8,2)` hours (or integer minutes — final choice in Phase 6 with tests). Same rule: no floats.
- Distinct named measures, never conflated: `estimated`, `allocated` (planned per employee), `logged` (submitted), `approved`, `billable`, `billed`. Defined in `domain-model.md`.

## Time
- Instants: `timestamptz`, stored UTC, displayed in tenant/user timezone (default `Asia/Kuwait`, UTC+3, no DST).
- Calendar dates (leave days, due dates, pay periods): `date` type — never midnight timestamps.
- Work week configurable per tenant; Kuwait default Sunday–Thursday, weekend Friday–Saturday. Public holidays tenant-managed (Islamic holidays move yearly, so not hardcoded).
