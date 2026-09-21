import { loadVocabulary, rank, type Match } from '~/ml/vocabulary'

/**
 * How sure the model has to be before the app claims to know what it is
 * looking at.
 *
 * Two conditions, not one. A high top score on its own is not enough, because
 * CLIP similarities sit in a narrow band and the best of thirty options is
 * always going to win something. The margin over the runner-up is what
 * distinguishes "this is a bird" from "these all look equally plausible".
 */
const MIN_SCORE = 0.22
const MIN_MARGIN = 0.02

export type Recognition = {
  key: string
  confidence: number
  /** False when the app should ask the user what they saw instead. */
  confident: boolean
  ranked: Match[]
}

/**
 * Maps the gap between the top two matches onto 0..1.
 *
 * Deliberately not the raw similarity: that number means little on its own and
 * showing it would imply a precision the model does not have.
 */
function confidenceOf(best: Match, runnerUp: Match | undefined): number {
  const margin = runnerUp ? best.score - runnerUp.score : best.score
  const scaled = (margin - MIN_MARGIN) / 0.12
  return Math.min(1, Math.max(0, scaled))
}

export async function recognise(imageVector: Float32Array): Promise<Recognition | null> {
  const vocabulary = await loadVocabulary()
  if (!vocabulary) return null

  const ranked = rank(imageVector, vocabulary)
  const best = ranked[0]
  if (!best) return null

  const confident = best.score >= MIN_SCORE && confidenceOf(best, ranked[1]) > 0
  // 'pattern' is the vocabulary's way of saying "nothing in particular", so
  // winning with it is a reason to ask rather than to announce.
  const meaningful = best.key !== 'pattern'

  return {
    key: best.key,
    confidence: confidenceOf(best, ranked[1]),
    confident: confident && meaningful,
    ranked,
  }
}

export const RECOGNITION_THRESHOLDS = { MIN_SCORE, MIN_MARGIN, confidenceOf }
