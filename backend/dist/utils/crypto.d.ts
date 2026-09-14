/**
 * Lightweight token encryption utility
 * ─────────────────────────────────────────────────────────────────────────
 * OAuth tokens are encrypted before being placed in the JWT payload.
 * This provides an extra layer of protection: even if a JWT is decoded,
 * the raw OAuth tokens are not exposed.
 *
 * Uses AES-256-GCM (authenticated encryption).
 * Key is derived from JWT_SECRET via HKDF-SHA256.
 * ─────────────────────────────────────────────────────────────────────────
 */
/**
 * Encrypt a plain-text token string.
 * Returns: base64( iv + authTag + ciphertext )
 */
export declare function encryptToken(plaintext: string): string;
/**
 * Decrypt an encrypted token string.
 * Throws if the ciphertext has been tampered with.
 */
export declare function decryptToken(ciphertext: string): string;
