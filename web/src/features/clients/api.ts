export const clientPaths = {
  list: "/tenants",
  people: "/people",
  detail: (id: string) => `/tenants/${encodeURIComponent(id)}`,
  profile: (id: string) => `/tenants/${encodeURIComponent(id)}/profile`,
  lock: (id: string) => `/tenants/${encodeURIComponent(id)}/lock`,
  unlock: (id: string) => `/tenants/${encodeURIComponent(id)}/unlock`,
  trial: (id: string) => `/tenants/${encodeURIComponent(id)}/trial`,
  activate: (id: string) => `/tenants/${encodeURIComponent(id)}/activate`,
  readOnlyExtension: (id: string) => `/tenants/${encodeURIComponent(id)}/read-only-extension`,
  notes: (id: string) => `/tenants/${encodeURIComponent(id)}/notes`,
  member: (id: string, membershipId: string, action: "suspend" | "reactivate") =>
    `/tenants/${encodeURIComponent(id)}/members/${encodeURIComponent(membershipId)}/${action}`,
} as const;
