// ScoreCrux — Agent Effectiveness Metric Standard
// Reference implementation of METRICS.md v1.0

export type {
  CruxFundamentals,
  CruxDerived,
  CruxComposite,
  CruxScore,
  CruxWeights,
  CruxRunMetadata,
  SafetyContext,
} from "./types.js";

export { DEFAULT_WEIGHTS } from "./types.js";
export { computeDerived } from "./derived.js";
export { computeComposite } from "./composite.js";
export { computeCruxScore } from "./score.js";
export {
  extractFundamental,
  extractFundamentals,
  computeDerivedSingle,
  computeDerivedSubset,
} from "./single.js";
export type { FundamentalId, DerivedId } from "./single.js";
export { fromCommunityLite } from "./community-lite.js";
export type { CommunityLiteInput, CommunityLiteExtra } from "./community-lite.js";
export { generatePassport, verifyPassport, isValidPassportFormat } from "./passport.js";
