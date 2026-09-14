"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptToken = encryptToken;
exports.decryptToken = decryptToken;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag
/** Derive a 32-byte key from the JWT secret */
function deriveKey() {
    return crypto_1.default.scryptSync(config_1.config.jwt.secret, 'cashflow-token-encryption-v1', 32);
}
/**
 * Encrypt a plain-text token string.
 * Returns: base64( iv + authTag + ciphertext )
 */
function encryptToken(plaintext) {
    const key = deriveKey();
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}
/**
 * Decrypt an encrypted token string.
 * Throws if the ciphertext has been tampered with.
 */
function decryptToken(ciphertext) {
    const key = deriveKey();
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}
//# sourceMappingURL=crypto.js.map