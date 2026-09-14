/**
 * Date Parsing Utilities
 * ─────────────────────────────────────────────────────────────────────────
 * Extracts dates from bank email formats common in India.
 *
 * Formats handled:
 *   17-Aug-2024
 *   17/08/2024
 *   Aug 17, 2024
 *   17 August 2024
 *   2024-08-17
 *   17-08-2024 12:34:56
 *   17 Aug 24, 12:34 PM
 * ─────────────────────────────────────────────────────────────────────────
 */

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

const DATE_PATTERNS: Array<{ pattern: RegExp; parse: (m: RegExpMatchArray) => Date | null }> = [
  // ISO: 2024-08-17 (with optional time)
  {
    pattern: /(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/,
    parse: (m) => {
      const d = new Date(
        parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
        parseInt(m[4] ?? '0'), parseInt(m[5] ?? '0'), parseInt(m[6] ?? '0')
      );
      return isValidDate(d) ? d : null;
    },
  },
  // DD-Mon-YYYY or DD Mon YYYY (e.g. 17-Aug-2024, 17 August 2024)
  {
    pattern: /(\d{1,2})[-\s]([A-Za-z]+)[-\s,\s](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?/i,
    parse: (m) => {
      const monthIdx = MONTH_MAP[m[2].toLowerCase()];
      if (monthIdx === undefined) return null;
      let hours = parseInt(m[4] ?? '0');
      const minutes = parseInt(m[5] ?? '0');
      const ampm = m[7]?.toUpperCase();
      if (ampm === 'PM' && hours !== 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      const d = new Date(parseInt(m[3]), monthIdx, parseInt(m[1]), hours, minutes);
      return isValidDate(d) ? d : null;
    },
  },
  // Mon DD, YYYY (e.g. Aug 17, 2024)
  {
    pattern: /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?/i,
    parse: (m) => {
      const monthIdx = MONTH_MAP[m[1].toLowerCase()];
      if (monthIdx === undefined) return null;
      let hours = parseInt(m[4] ?? '0');
      const minutes = parseInt(m[5] ?? '0');
      const ampm = m[7]?.toUpperCase();
      if (ampm === 'PM' && hours !== 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      const d = new Date(parseInt(m[3]), monthIdx, parseInt(m[2]), hours, minutes);
      return isValidDate(d) ? d : null;
    },
  },
  // DD/MM/YYYY or DD-MM-YYYY (with optional time HH:MM:SS)
  {
    pattern: /(\d{2})[\/\-](\d{2})[\/\-](\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/,
    parse: (m) => {
      const d = new Date(
        parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]),
        parseInt(m[4] ?? '0'), parseInt(m[5] ?? '0'), parseInt(m[6] ?? '0')
      );
      return isValidDate(d) ? d : null;
    },
  },
  // DD Mon YY (e.g. 17 Aug 24) – 2-digit year
  {
    pattern: /(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2})(?:\s*,?\s*(\d{1,2}):(\d{2})(?:\s*(AM|PM))?)?/i,
    parse: (m) => {
      const monthIdx = MONTH_MAP[m[2].toLowerCase()];
      if (monthIdx === undefined) return null;
      const year = parseInt(m[3]) + 2000;
      let hours = parseInt(m[4] ?? '0');
      const minutes = parseInt(m[5] ?? '0');
      const ampm = m[6]?.toUpperCase();
      if (ampm === 'PM' && hours !== 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
      const d = new Date(year, monthIdx, parseInt(m[1]), hours, minutes);
      return isValidDate(d) ? d : null;
    },
  },
];

function isValidDate(d: Date): boolean {
  return d instanceof Date && !isNaN(d.getTime()) && d.getFullYear() > 2000;
}

/**
 * Extract a date from a bank email body.
 * @returns ISO 8601 string, or null if no date found.
 */
export function extractDate(text: string): string | null {
  for (const { pattern, parse } of DATE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const date = parse(match);
      if (date) return date.toISOString();
    }
  }
  return null;
}

/**
 * Return YYYY-MM-DD from an ISO string (for dedup comparison).
 */
export function toDateOnly(isoString: string): string {
  return isoString.substring(0, 10);
}

/**
 * Check if a date string is within the allowed lookback window.
 */
export function isWithinLookback(dateStr: string, lookbackDays: number): boolean {
  const date = new Date(dateStr);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  return date >= cutoff;
}
