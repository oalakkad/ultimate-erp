/**
 * An update request must change something. Partial update bodies without a required field
 * (such as `version`) would otherwise accept `{}`, and an empty SET is a server error
 * (found by the cross-tenant sweep, security.md §2g). Answered as 422 `empty_update`.
 */
export const hasAnyField = (body: object): boolean =>
  Object.values(body).some((value) => value !== undefined);
export const EMPTY_UPDATE = { message: 'empty_update' } as const;
