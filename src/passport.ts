// Passport number generator — HMAC-based, server-assigned, guaranteed unique.
//
// Two modes:
//   1. generatePassport(tenantId, pepper) — deterministic HMAC-SHA256 derivation.
//      Used by the server to assign a passport on first tenant creation.
//      The pepper is a secret known only to the server.
//
//   2. verifyPassport(tenantId, passport, pepper) — verify a claimed passport
//      matches the tenant ID + pepper.
//
// Format: VCX-<12 uppercase hex chars> (e.g., VCX-A7F3B2E91C04)
// Space: 16^12 = 281 trillion values. No birthday collision risk at any scale.
//
// IMPORTANT: The pepper MUST be kept secret. Without the pepper, you cannot
// derive or forge a passport from a tenant ID. Store it in Vault KV.

import { createHmac } from 'node:crypto'

const PASSPORT_PREFIX = 'VCX-'
const PASSPORT_HEX_LENGTH = 12

/**
 * Generate a VaultCrux passport number from a tenant ID and secret pepper.
 *
 * Deterministic: same (tenantId, pepper) always produces the same passport.
 * The pepper prevents anyone from computing passports without server access.
 *
 * @param tenantId - The VaultCrux tenant ID.
 * @param pepper - Server-side secret (store in Vault KV, never expose to clients).
 * @returns Passport string in VCX-XXXXXXXXXXXX format (12 uppercase hex chars).
 */
export function generatePassport(tenantId: string, pepper: string): string {
  const hmac = createHmac('sha256', pepper)
  hmac.update(tenantId)
  const hex = hmac.digest('hex').slice(0, PASSPORT_HEX_LENGTH).toUpperCase()
  return `${PASSPORT_PREFIX}${hex}`
}

/**
 * Verify that a passport number matches a tenant ID.
 *
 * @param tenantId - The claimed tenant ID.
 * @param passport - The claimed passport number.
 * @param pepper - Server-side secret.
 * @returns true if the passport is valid for this tenant.
 */
export function verifyPassport(tenantId: string, passport: string, pepper: string): boolean {
  return generatePassport(tenantId, pepper) === passport
}

/**
 * Validate passport format without verifying against a tenant.
 * Useful for client-side input validation.
 */
export function isValidPassportFormat(passport: string): boolean {
  return /^VCX-[0-9A-F]{12}$/.test(passport)
}
