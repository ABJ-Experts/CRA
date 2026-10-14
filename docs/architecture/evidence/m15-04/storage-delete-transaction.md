# Cached Storage deletion ordering evidence

Inspected task container `cra_m15_04_storage`, image `public.ecr.aws/supabase/storage-api:v1.77.0`, digest `sha256:3999cfa4f3286f945fa68069fc9b8b6bf3929a6bd53916dcf2e8c209801173c0`.

Copied executable image artifacts, not web source assumptions:

- `storage-delete-route.image.js`: HTTP DELETE object bucket route calls `request.storage.from(bucketName).deleteObjects(prefixes)`.
- `storage-object.image.js`: `ObjectStorage.deleteObjects` at129 opens `this.db.withTransaction` at142; calls awaited `db.deleteObjects` at144; calls awaited `this.backend.deleteObjects` at162; the transaction callback ends at177. Single `deleteObject` uses the same sequence at87/97/101.
- `storage-pg.image.js`: `StoragePgDB.deleteObjects` at979 runs literal `DELETE FROM storage.objects ... RETURNING *`, additionally `archived_at IS NULL` for versioned schemas. `StoragePgDB.withTransaction` at126 obtains the transaction, awaits the callback at142, then calls `tnx.commit()` at149. Errors roll back.
- `storage-object-v1.67.image.js`: the existing Storage1.67.20 container has the same transaction boundary: callback121, metadata delete122, physical backend delete138, callback ends153.

The metadata DELETE statement runs before physical deletion, and metadata COMMIT runs after physical deletion. A bucket-specific BEFORE DELETE trigger therefore executes before any backend removal. An organization advisory transaction lock acquired there remains held across the awaited physical operation and commits afterward. Protective fact writers acquiring the same organization transaction lock serialize with this boundary: a protection fact committed first is visible to the trigger and denies deletion; a later writer waits for the already-authorized deletion transaction to finish. Other buckets are unaffected by a support-diagnostics-only trigger.

The trigger can recheck live cleanup lease/deleting state, fixed owned object path, current retention/hold policy and reviewed fingerprint after taking that lock. Recording authorization inside the transaction must preserve the optimistic job version expected by finish_cleanup, or deliberately return/reconcile its new version. The worker must still perform pre-delete authorization and post-delete fenced completion; the trigger closes the gap during the Storage HTTP request.

This inspection made no code, schema or runtime modifications. Copied image code is retained in the ignored task evidence directory.
