/**
 * Certificate serial code: a crypto-random Crockford base32 string, not a
 * sequential/guessable id. "Verifiable" here means looking it up against
 * the unique `certificates.serial_code` column — there's no public offline
 * verifier requested, so a DB-backed lookup is the natural fit rather than
 * a signed hash that would need its own secret to manage.
 */
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeCrockfordBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

/** e.g. "BINAH-7K2M-QX9H-4RTN" — 12 symbols (60 bits of entropy). */
export function generateSerialCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const symbols = encodeCrockfordBase32(bytes).slice(0, 12);
  const prefix = DEFAULT_BRAND.shortName.toUpperCase();
  return `${prefix}-${symbols.slice(0, 4)}-${symbols.slice(4, 8)}-${symbols.slice(8, 12)}`;
}
