import { Transform } from 'class-transformer';

/**
 * Trims a text value before validation, then optionally changes its case.
 * Anything that is not a string is left as is, for the validators to refuse.
 */
function trimmed(change: (text: string) => string): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? change(value.trim()) : value,
  );
}

/** `"  Bamako "` -> `"Bamako"`. */
export function Trim(): PropertyDecorator {
  return trimmed((text) => text);
}

/** For codes: `" ml "` -> `"ML"`. */
export function TrimUpperCase(): PropertyDecorator {
  return trimmed((text) => text.toUpperCase());
}

/** For emails: `" Awa@Batisso.ML "` -> `"awa@batisso.ml"`. */
export function TrimLowerCase(): PropertyDecorator {
  return trimmed((text) => text.toLowerCase());
}
