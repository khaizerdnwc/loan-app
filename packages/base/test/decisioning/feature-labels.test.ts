import { FEATURE_LABEL } from "@loan/core";
import { PROHIBITED_FEATURES, SCORECARDS } from "../../src/decisioning/engine";

/**
 * MG-2: the registry shows features in plain words. Every attribute a scorecard reads, and
 * every prohibited one, has a label, so no screen falls back to an identifier.
 */
describe("every scoring and prohibited feature has a plain-words label", () => {
  const scoring = [...new Set(Object.values(SCORECARDS).flatMap((sc) => sc.features))];

  it.each(scoring)("scoring feature %s", (feature) => {
    expect(FEATURE_LABEL[feature]).toEqual(expect.any(String));
  });

  it.each([...PROHIBITED_FEATURES])("prohibited feature %s", (feature) => {
    expect(FEATURE_LABEL[feature]).toEqual(expect.any(String));
  });
});
