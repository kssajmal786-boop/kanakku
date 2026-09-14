"use strict";
/**
 * Canonical Transaction Schema
 * ─────────────────────────────────────────────────────────────────────────
 * Every transaction in the system—regardless of origin—is normalised into
 * this single shape before being returned to the client.
 *
 * Design decisions beyond the original spec:
 *   • `currency`      – added for multi-currency support (defaults to "INR")
 *   • `rawAmount`     – preserves the exact string parsed from the source
 *   • `confidence`    – parser certainty [0-1]; used by deduplication
 *   • `parseStatus`   – tracks whether parsing fully succeeded
 *   • `tags`          – user-extensible labels (merged from parser hints)
 *   • `linkedTxnId`   – for ATM: links the cash-out to subsequent cash spends
 *   • `gmailMessageId`– non-sensitive Gmail identifier for dedup; NOT content
 * ─────────────────────────────────────────────────────────────────────────
 */
Object.defineProperty(exports, "__esModule", { value: true });
//# sourceMappingURL=transaction.types.js.map