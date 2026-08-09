const all = Object.freeze(["session"] as const);
const identity = Object.freeze(["session", "identity"] as const);
const permissions = Object.freeze(["session", "permissions"] as const);
const menu = Object.freeze(["session", "permissions", "menu"] as const);

export const sessionKeys = Object.freeze({ all, identity, permissions, menu });
