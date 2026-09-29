import {
  connectorConfigurationInputSchema,
  connectorTypeSchema,
} from "@repo/contracts/connectors/schemas";
import type { z } from "zod";

/** A planned catalogue entry is never an executable connector configuration. */
export function parseConnectorConfiguration(
  connectorType: string,
  configuration: unknown,
): z.output<typeof connectorConfigurationInputSchema> {
  connectorTypeSchema.parse(connectorType);
  return connectorConfigurationInputSchema.parse(configuration);
}
