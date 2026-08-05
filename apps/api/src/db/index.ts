// Public interface (Facade) for the db module. Other modules import DB access
// only from here — never a deep path (enforced by the boundaries lint rule).
export {
  db,
  pool,
  feedDb,
  withTenant,
  withPrincipal,
  withUserLookup,
  withFeedWriter,
  listOrganisationIds,
  closeDb,
  type Db,
  type Tx,
  type TenantScope,
} from './database';
export { assertRlsBootSafety } from './sec014';
export * from './schema';
