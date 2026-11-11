// Fixture: a browser global on no list. The browser env is off in pure zones, so no-undef catches it.
export const perm = () => Notification.permission;
