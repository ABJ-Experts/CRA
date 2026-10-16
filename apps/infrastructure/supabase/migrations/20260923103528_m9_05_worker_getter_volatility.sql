-- The lease check uses clock_timestamp(), which is volatile.
alter function public.get_supplier_document_extraction_worker_atomic(uuid,uuid,uuid) volatile;
