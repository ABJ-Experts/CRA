import type { z } from "zod";

import type {
  chatChannelModeSchema,
  chatChannelMutationResponseSchema,
  chatChannelParamsSchema,
  chatChannelSchema,
  chatChannelTestResponseSchema,
  chatChannelsResponseSchema,
  chatDeliveriesQuerySchema,
  chatDeliveriesResponseSchema,
  chatDeliveryMutationResponseSchema,
  chatDeliveryParamsSchema,
  chatDeliverySchema,
  chatDeliveryStatusSchema,
  chatDestinationInputSchema,
  chatEventClassSchema,
  confirmChatChannelInputSchema,
  createChatChannelInputSchema,
  retryChatDeliveryInputSchema,
  setChatChannelEnabledInputSchema,
  testChatChannelInputSchema,
  updateChatChannelInputSchema,
} from "../schemas/index.js";

export type ChatChannelMode = z.output<typeof chatChannelModeSchema>;
export type ChatEventClass = z.output<typeof chatEventClassSchema>;
export type ChatDeliveryStatus = z.output<typeof chatDeliveryStatusSchema>;
export type ChatDestinationInput = z.output<typeof chatDestinationInputSchema>;
export type CreateChatChannelInput = z.output<
  typeof createChatChannelInputSchema
>;
export type UpdateChatChannelInput = z.output<
  typeof updateChatChannelInputSchema
>;
export type ChatChannelParams = z.output<typeof chatChannelParamsSchema>;
export type TestChatChannelInput = z.output<typeof testChatChannelInputSchema>;
export type ConfirmChatChannelInput = z.output<
  typeof confirmChatChannelInputSchema
>;
export type SetChatChannelEnabledInput = z.output<
  typeof setChatChannelEnabledInputSchema
>;
export type ChatChannel = z.output<typeof chatChannelSchema>;
export type ChatChannelsResponse = z.output<typeof chatChannelsResponseSchema>;
export type ChatChannelMutationResponse = z.output<
  typeof chatChannelMutationResponseSchema
>;
export type ChatChannelTestResponse = z.output<
  typeof chatChannelTestResponseSchema
>;
export type ChatDeliveriesQuery = z.output<typeof chatDeliveriesQuerySchema>;
export type ChatDeliveryParams = z.output<typeof chatDeliveryParamsSchema>;
export type ChatDelivery = z.output<typeof chatDeliverySchema>;
export type ChatDeliveriesResponse = z.output<
  typeof chatDeliveriesResponseSchema
>;
export type ChatDeliveryMutationResponse = z.output<
  typeof chatDeliveryMutationResponseSchema
>;
export type RetryChatDeliveryInput = z.output<
  typeof retryChatDeliveryInputSchema
>;
