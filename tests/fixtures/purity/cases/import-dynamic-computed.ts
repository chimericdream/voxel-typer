// Fixture: dynamic import with a computed specifier (cannot be checked, so it fails).
export const load = (name: string) => import(`@/content/${name}`);
