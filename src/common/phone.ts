import {
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/max';

/**
 * Phone helpers shared by countries and stores. Pure functions: callers decide
 * which HTTP error to raise.
 *
 * `libphonenumber-js/max`: the full metadata checks each country's real number
 * ranges. The default entry point only checks the length, so `00 00 00 00 00`
 * would pass for Côte d'Ivoire.
 */

/** True when libphonenumber knows this ISO country (so it can derive a prefix). */
export function isPhoneCountry(code: string): code is CountryCode {
  return isSupportedCountry(code);
}

/** International prefix of a supported country, e.g. `ML` -> `+223`. */
export function getPhonePrefix(code: CountryCode): string {
  return `+${getCountryCallingCode(code)}`;
}

/**
 * Normalizes a phone number of `country` to E.164 (`+22376000000`), or returns
 * null when it is not a valid number of that country. Accepts the local format
 * (`76 00 00 00`) and the international one; a valid number of another country
 * is rejected, since stores, staff, and customers belong to one country.
 */
export function normalizePhone(
  value: string,
  country: CountryCode,
): string | null {
  const parsed = parsePhoneNumberFromString(value, country);
  if (!parsed || !parsed.isValid() || parsed.country !== country) {
    return null;
  }
  return parsed.number;
}
