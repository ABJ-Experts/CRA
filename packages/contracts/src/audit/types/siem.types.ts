import { z } from "zod";
import type * as schemas from "../schemas/siem.schema.js";
export type SiemConfig = z.output<typeof schemas.siemConfigSchema>;
export type SiemCreateDestination = z.output<
  typeof schemas.siemCreateDestinationSchema
>;
export type SiemUpdateDestination = z.output<
  typeof schemas.siemUpdateDestinationSchema
>;
export type SiemOperation = z.output<typeof schemas.siemOperationSchema>;
export type SiemCredential = z.output<typeof schemas.siemCredentialSchema>;
export type SiemCredentialInput = z.output<
  typeof schemas.siemCredentialInputSchema
>;
export type SiemDestination = z.output<typeof schemas.siemDestinationSchema>;
export type SiemDestinationList = z.output<
  typeof schemas.siemDestinationListSchema
>;
export type SiemDelivery = z.output<typeof schemas.siemDeliverySchema>;
export type SiemDeliveryDetail = z.output<
  typeof schemas.siemDeliveryDetailSchema
>;
export type SiemDeliveryPage = z.output<typeof schemas.siemDeliveryPageSchema>;
export type SiemReplayPreview = z.output<
  typeof schemas.siemReplayPreviewSchema
>;
export type SiemReplayInput = z.output<typeof schemas.siemReplayInputSchema>;
export type SiemTestResult = z.output<typeof schemas.siemTestResultSchema>;
export type SiemCatalogue = z.output<typeof schemas.siemCatalogueSchema>;
export type SiemEvent = z.output<typeof schemas.siemEventSchema>;
export type SiemEventClass = z.output<typeof schemas.siemEventClassSchema>;
export type SiemTransport = z.output<typeof schemas.siemTransportSchema>;
export type SiemFormat = z.output<typeof schemas.siemFormatSchema>;
export type SiemReadQuery = z.output<typeof schemas.siemReadQuerySchema>;
export type SiemPageQuery = z.output<typeof schemas.siemPageQuerySchema>;
export type SiemDestinationParams = z.output<
  typeof schemas.siemDestinationParamsSchema
>;
export type SiemDeliveryParams = z.output<
  typeof schemas.siemDeliveryParamsSchema
>;
export type SiemAttempt = z.output<typeof schemas.siemAttemptSchema>;
