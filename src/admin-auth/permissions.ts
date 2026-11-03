/**
 * What a role can let an admin do (feature 20). A fixed list: each area has a
 * permission to read and one to change. Admins and roles have none: only the
 * super admin manages them, or a role manager could give themselves everything.
 */
export const PERMISSIONS = {
  'countries.read': 'Voir les pays',
  'countries.manage': 'Créer et modifier les pays',
  'stores.read': 'Voir les quincailleries',
  'stores.manage':
    'Enregistrer, modifier, vérifier, suspendre et fermer les quincailleries',
  'store-settings.manage': 'Modifier les paramètres d’une quincaillerie',
  'settings.read': 'Voir les paramètres de la plateforme',
  'settings.manage': 'Modifier les paramètres de la plateforme',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const PERMISSION_NAMES = Object.keys(PERMISSIONS) as Permission[];

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && Object.hasOwn(PERMISSIONS, value);
}

/** The role every existing admin received with this feature: today's access. */
export const DEFAULT_ROLE = {
  name: 'Administrateur',
  permissions: [
    'countries.read',
    'countries.manage',
    'stores.read',
    'stores.manage',
    'store-settings.manage',
    'settings.read',
  ] satisfies Permission[],
};
