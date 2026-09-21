# KOVA

Kayelen's Operations and Vehicle Allocation.

This package contains the production-oriented KOVA frontend completed through Phase 8. It does not include demo accounts, browser-only records, fake passwords, or role-preview shortcuts. The interface connects to a real backend through the typed adapter in `lib/kova-api.ts`.

## Requirements

- Node.js 22.13 or newer
- pnpm 11
- A backend implementing `BACKEND_INTEGRATION.md`

## Setup

1. Copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_KOVA_API_BASE_URL` to your backend origin. Leave it blank when the backend is served from the same origin.
3. Install dependencies with `pnpm install`.
4. Start development with `pnpm dev`.
5. Build with `pnpm build`.

## Security boundary

The frontend mirrors permissions only for the user experience. Your backend must authenticate every request and enforce roles, booking ownership, Vehicle and Driver conflicts, submitted-record locks, and Admin-only Finance/PDF actions. Passwords must be hashed by the backend and must never be returned to this application.

See [BACKEND_INTEGRATION.md](BACKEND_INTEGRATION.md) for the endpoint and data contract.
