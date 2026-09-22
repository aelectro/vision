/**
 * Hands control back to the browser mid-task.
 *
 * Training a feedback example is a few hundred milliseconds of arithmetic on a
 * phone. Run straight through, that is a few hundred milliseconds during which
 * nothing scrolls and no tap registers. Yielding between optimiser steps costs
 * nothing measurable and keeps the page alive; the learning is identical
 * either way.
 */
type SchedulerLike = { yield?: () => Promise<void> }

export function yieldToBrowser(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler
  if (scheduler?.yield) return scheduler.yield()

  // setTimeout(0) is clamped but still lets pending input and paint through,
  // which is the whole point.
  return new Promise((resolve) => setTimeout(resolve, 0))
}
