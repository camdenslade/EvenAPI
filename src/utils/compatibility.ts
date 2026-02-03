//********************************************************************
//
// Compatibility Utilities
//
// Functions for calculating compatibility scores between profiles.
// Used for sorting swipe queue results by soft preference matching.
//
//*******************************************************************

export interface CompatibilityInput {
  mySex: "male" | "female";
  theirSex: "male" | "female";
  myPreference: "male" | "female" | "everyone";
  theirPreference: "male" | "female" | "everyone";
  distanceMiles: number;
  sharedInterests: string[];
  myDatingPreference?: string;
  theirDatingPreference?: string;
}

/**
 * Calculates a compatibility score (0-100) between two users based on
 * dating intentions, shared interests, and distance.
 * Used for sorting, not filtering.
 */
export function computeCompatibilityScore(input: CompatibilityInput): number {
  let score = 0;

  // Dating preference match (0-30 points)
  if (input.myDatingPreference && input.theirDatingPreference) {
    if (input.myDatingPreference === input.theirDatingPreference) {
      score += 30;
    } else {
      // Partial matches for compatible preferences
      const compatible = [
        ["hookups", "situationship"],
        ["short_term_relationship", "short_term_open"],
        ["long_term_relationship", "long_term_open"],
      ];
      const isCompatible = compatible.some(
        (pair) =>
          (input.myDatingPreference &&
            input.theirDatingPreference &&
            pair.includes(input.myDatingPreference) &&
            pair.includes(input.theirDatingPreference)) ||
          (input.myDatingPreference?.includes("open") &&
            input.theirDatingPreference?.includes("open")),
      );
      if (isCompatible) {
        score += 15;
      }
    }
  }

  // Shared interests (0-40 points)
  const interestScore = Math.min(40, input.sharedInterests.length * 5);
  score += interestScore;

  // Distance (0-30 points) - closer is better
  const distScore = Math.max(0, 30 - input.distanceMiles / 2);
  score += distScore;

  return Math.min(100, score);
}
