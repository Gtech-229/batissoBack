/**
 * The categories every new store starts with (user decision, 2026-10-23); its
 * managers rename them or add their own. The catalogue migration gave the same
 * set to the stores that already existed.
 */
export const DEFAULT_ARTICLE_CATEGORIES = [
  'Ciment',
  'Fer et acier',
  'Tôles et toiture',
  'Bois',
  'Sable et gravier',
  'Briques et parpaings',
  'Plomberie',
  'Électricité',
  'Peinture',
  'Carrelage',
  'Quincaillerie',
] as const;
