// The "agreed threshold" from BRD §25's MVP exit condition, as a reviewed number
// in source rather than a conversation.
//
// Why these are 1.0 and not something like 0.95:
//
// §25 frames the exit condition as a *rate* ("false positive rate on the golden
// dataset below the agreed threshold") because it is thinking about real SBOMs
// from design partners, where some irreducible ambiguity exists — a vendor
// mislabels an ecosystem, an advisory's range is genuinely wrong upstream.
//
// This corpus is different in kind. Every case is curated and has a single
// known-correct answer derived from a stated rule. There is no ambiguity to
// absorb, so any miss is a defect rather than noise, and a tolerance band would
// only let one silently accumulate. The rate-based threshold belongs on the
// real-world corpus (V1 work, once design partners have supplied SBOMs); on the
// curated set the bar is exact.
//
// If a case here is genuinely arguable, the fix is to correct or delete the
// case with a recorded reason — never to lower this number.
export const ACCURACY_THRESHOLDS = {
  /** tp / (tp + fp). Below 1.0 means the queue contains noise. */
  MIN_PRECISION: 1.0,
  /** tp / (tp + fn). Below 1.0 means a real vulnerability went unreported. */
  MIN_RECALL: 1.0,
} as const;

/**
 * Guards against the corpus being gutted and the suite still passing green.
 * Raise it when cases are added; never lower it to accommodate a deletion.
 */
export const MIN_CORPUS_SIZE = 30;
