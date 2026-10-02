import {
  productClassificationAnswersSchema,
  productClassificationPolicySchema,
} from "../schemas/product-classification.schema.js";
import type {
  ProductClassificationAnswers,
  ProductClassification,
} from "../types/product-classification.type.js";

const regulation =
  "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R2847";
const descriptions =
  "https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:32025R2392";
/** Human declarations, not automatic legal category matching or qualified approval. */
export const PRODUCT_CLASSIFICATION_POLICY =
  productClassificationPolicySchema.parse({
    version: "cra-human-declarations-v1",
    hash: "5941925c5f13b71bb98a1b9f109c359844b8ac531ad5b9ad0ce072333f6237b3",
    effectiveDate: "2026-09-28",
    status: "engineering_provisional",
    sourceRefs: [
      {
        title: "Regulation (EU) 2024/2847: scope and classification",
        url: regulation,
      },
      {
        title:
          "Implementing Regulation (EU) 2025/2392: category technical descriptions",
        url: descriptions,
      },
    ],
    questions: [
      {
        key: "scope",
        prompt:
          "Have you determined that this product falls within CRA scope after reviewing Article 2 and its exclusions?",
        sourceRefs: [regulation],
      },
      {
        key: "criticalCoreFunction",
        prompt:
          "Does the product's core functionality match a critical product category in Annex IV? Review the official categories and technical descriptions before answering.",
        sourceRefs: [regulation, descriptions],
      },
      {
        key: "classIICoreFunction",
        prompt:
          "Does the product's core functionality match an important Class II category in Annex III? Review the official categories and technical descriptions before answering.",
        sourceRefs: [regulation, descriptions],
      },
      {
        key: "classICoreFunction",
        prompt:
          "Does the product's core functionality match an important Class I category in Annex III? Review the official categories and technical descriptions before answering.",
        sourceRefs: [regulation, descriptions],
      },
    ],
  });
/** Validates branch visibility even for direct callers outside an API boundary. */
export function deriveProductClassification(
  input: ProductClassificationAnswers,
): ProductClassification {
  const answers = productClassificationAnswersSchema.parse(input);
  if (answers.scope !== "in_scope") return answers.scope;
  if (answers.criticalCoreFunction === "yes") return "critical";
  if (answers.criticalCoreFunction === "undetermined") return "undetermined";
  if (answers.classIICoreFunction === "yes") return "important_class_ii";
  if (answers.classIICoreFunction === "undetermined") return "undetermined";
  if (answers.classICoreFunction === "yes") return "important_class_i";
  return answers.classICoreFunction === "undetermined"
    ? "undetermined"
    : "default";
}
