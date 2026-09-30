import {
  connectorConfigurationInputSchema,
  connectorTypeSchema,
  parseConnectorConfigurationForType,
} from "@repo/contracts/connectors/schemas";
import type { z } from "zod";

export function parseConnectorConfiguration(
  connectorType: string,
  configuration: unknown,
):
  | z.output<typeof connectorConfigurationInputSchema>
  | Readonly<Record<string, string>> {
  return parseConnectorConfigurationForType(
    connectorTypeSchema.parse(connectorType),
    configuration,
  );
}
