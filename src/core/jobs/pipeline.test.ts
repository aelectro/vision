import { describe, expect, it } from 'vitest'

import { enqueue } from '~/core/jobs/pipeline'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('the job queue', () => {
  it('runs tasks one at a time, in order', async () => {
    const events: string[] = []

    const task = (name: string, delay: number) => async () => {
      events.push(`${name}:start`)
      await new Promise((resolve) => setTimeout(resolve, delay))
      events.push(`${name}:end`)
    }

    // The slow one is queued first on purpose: if these overlapped, the fast
    // task would finish in the middle of the slow one.
    const first = enqueue(task('slow', 30))
    const second = enqueue(task('fast', 0))
    await Promise.all([first, second])

    expect(events).toEqual(['slow:start', 'slow:end', 'fast:start', 'fast:end'])
  })

  it('keeps going after a task fails', async () => {
    let ran = false

    const failing = enqueue(async () => {
      throw new Error('render failed')
    })
    await expect(failing).rejects.toThrow('render failed')

    await enqueue(async () => {
      ran = true
    })
    expect(ran).toBe(true)
  })

  it('does not leave an unhandled rejection when nothing follows a failure', async () => {
    const seen: unknown[] = []
    const onUnhandled = (reason: unknown) => seen.push(reason)
    process.on('unhandledRejection', onUnhandled)

    try {
      // Deliberately not awaited: this is exactly the case that used to leave
      // the chain holding a rejected promise with no handler attached.
      void enqueue(async () => {
        throw new Error('ignored')
      }).catch(() => undefined)

      await tick()
      await tick()
      expect(seen).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('serialises even when tasks are queued from inside a task', async () => {
    const order: number[] = []

    await enqueue(async () => {
      order.push(1)
      void enqueue(async () => {
        order.push(3)
      })
      await tick()
      order.push(2)
    })

    await enqueue(async () => {
      order.push(4)
    })

    expect(order).toEqual([1, 2, 3, 4])
  })
})
