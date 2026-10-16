export class SbomNormalizationError extends Error {
  constructor(
    readonly code:
      | "normalization_byte_limit_exceeded"
      | "normalization_component_limit_exceeded"
      | "normalization_malformed_input"
      | "normalization_unsupported_format"
      | "normalization_extreme_numeric_literal"
      | "normalization_projection_limit_exceeded"
      | "duplicate_local_reference"
      | "conflicting_local_reference_identity",
    message: string,
  ) {
    super(message);
  }
}

export class SbomStreamSourceError extends Error {
  constructor(readonly sourceError: unknown) {
    super(
      sourceError instanceof Error
        ? sourceError.message
        : "SBOM source unavailable.",
    );
  }
}
