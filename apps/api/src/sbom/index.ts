// Public interface (Facade) for the sbom module.
export {
  createRelease,
  ingestSbom,
  listReleases,
  rawSbomKey,
  type IngestResult,
  type ReleaseView,
} from './sbom.service';
export { SbomModule } from './sbom.module';
