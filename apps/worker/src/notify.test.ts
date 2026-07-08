import type { StatusChangePayload } from '@statusbeam/core'
import type { Env } from './env'
import type { NotificationMessage } from './notify'
import { buildStatusChangePayload } from '@statusbeam/core'
import { describe, expect, it } from 'bun:test'
import {
  buildNotificationMessages,
  consumeNotificationBatch,
  deliverNotification,
  dispatchNotifications,
  notify,
} from './notify'

const payload: StatusChangePayload = buildStatusChangePayload(
  [{ slug: 'api', from: 'up', to: 'down' }],
  '2026-07-08T00:00:00.000Z',
)

/** A fetch stub recording calls and returning a chosen response/behaviour. */
function fakeFetch(behaviour: (url: string) => { ok: boolean, status: number } | Error) {
  const calls: { url: string, body: unknown }[] = []
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const result = behaviour(url)
    if (result instanceof Error) {
      throw result
    }
    return { ok: result.ok, status: result.status } as Response
  }) as unknown as typeof fetch
  return { impl, calls }
}

describe('buildNotificationMessages', () => {
  it('returns an empty list when notifications are absent', () => {
    expect(buildNotificationMessages(undefined, payload)).toEqual([])
  })

  it('emits one message per target: slack (Block Kit) + each webhook (payload)', () => {
    const messages = buildNotificationMessages(
      {
        delivery: 'inline',
        slack: { webhookUrl: 'https://hooks.slack.com/services/T/B/X' },
        webhooks: [{ url: 'https://example.com/a' }, { url: 'https://example.com/b' }],
      },
      payload,
    )
    expect(messages.map(m => m.url)).toEqual([
      'https://hooks.slack.com/services/T/B/X',
      'https://example.com/a',
      'https://example.com/b',
    ])
    // Slack gets a formatted message; generic webhooks get the raw payload.
    expect((messages[0]?.body as { blocks: unknown[] }).blocks.length).toBeGreaterThan(0)
    expect(messages[1]?.body).toEqual(payload)
  })
})

describe('deliverNotification', () => {
  const message: NotificationMessage = { url: 'https://example.com/hook', body: payload }

  it('resolves on a 2xx response', async () => {
    const { impl, calls } = fakeFetch(() => ({ ok: true, status: 200 }))
    await expect(deliverNotification(message, impl)).resolves.toBeUndefined()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.body).toEqual(payload)
  })

  it('throws on a non-2xx response (so the queue retries)', async () => {
    const { impl } = fakeFetch(() => ({ ok: false, status: 500 }))
    await expect(deliverNotification(message, impl)).rejects.toThrow(/500/)
  })

  it('propagates a thrown fetch (network failure)', async () => {
    const { impl } = fakeFetch(() => new Error('network down'))
    await expect(deliverNotification(message, impl)).rejects.toThrow('network down')
  })
})

describe('dispatchNotifications (inline)', () => {
  it('POSTs every target and swallows a failing one', async () => {
    const { impl, calls } = fakeFetch(url =>
      url.includes('/bad') ? { ok: false, status: 500 } : { ok: true, status: 200 },
    )
    await dispatchNotifications(
      { delivery: 'inline', webhooks: [{ url: 'https://example.com/ok' }, { url: 'https://example.com/bad' }] },
      payload,
      impl,
    )
    // Both were attempted; the 500 did not throw or block the other.
    expect(calls.map(c => c.url)).toEqual(['https://example.com/ok', 'https://example.com/bad'])
  })
})

/**
 * A minimal Env whose NOTIFY_QUEUE records the batches it is sent. `binding`:
 * 'record' captures the enqueued batches, 'throw' simulates an enqueue failure
 * (quota/throttle/transient API error), 'none' omits the binding entirely.
 */
function queueEnv(binding: 'record' | 'throw' | 'none') {
  const sent: { body: NotificationMessage }[][] = []
  const queue = {
    record: { sendBatch: async (msgs: { body: NotificationMessage }[]) => { sent.push([...msgs]) } },
    throw: { sendBatch: async () => { throw new Error('queue backlog full') } },
    none: undefined,
  }[binding]
  const env = { NOTIFY_QUEUE: queue } as unknown as Env
  return { env, sent }
}

describe('notify (transport selection)', () => {
  it('enqueues one message per target when delivery is queue', async () => {
    const { env, sent } = queueEnv('record')
    await notify(
      env,
      {
        delivery: 'queue',
        slack: { webhookUrl: 'https://hooks.slack.com/services/T/B/X' },
        webhooks: [{ url: 'https://example.com/a' }],
      },
      payload,
    )
    expect(sent).toHaveLength(1)
    expect(sent[0]?.map(m => m.body.url)).toEqual([
      'https://hooks.slack.com/services/T/B/X',
      'https://example.com/a',
    ])
    // The enqueued body content survives the { body } wrap: Slack gets its
    // formatted message, the generic webhook gets the raw payload.
    expect((sent[0]?.[0]?.body.body as { blocks: unknown[] }).blocks.length).toBeGreaterThan(0)
    expect(sent[0]?.[1]?.body.body).toEqual(payload)
  })

  it('does not enqueue when there are no targets', async () => {
    const { env, sent } = queueEnv('record')
    await notify(env, { delivery: 'queue' }, payload)
    expect(sent).toHaveLength(0)
  })

  it('chunks a large target list into <=100-message sendBatch calls', async () => {
    const { env, sent } = queueEnv('record')
    // 150 webhooks + 1 slack = 151 messages → two batches (100 + 51).
    const webhooks = Array.from({ length: 150 }, (_, i) => ({ url: `https://example.com/${i}` }))
    await notify(env, { delivery: 'queue', slack: { webhookUrl: 'https://hooks.slack.com/services/T/B/X' }, webhooks }, payload)
    // 100 + 51 = 151 → every message enqueued exactly once, no chunk-boundary loss.
    expect(sent).toHaveLength(2)
    expect(sent[0]).toHaveLength(100)
    expect(sent[1]).toHaveLength(51)
  })

  it('dispatches only the un-enqueued remainder inline when a later chunk fails', async () => {
    // First sendBatch (100) succeeds, the second throws — the already-queued
    // 100 must NOT be re-POSTed inline (that would double-deliver them); only
    // the 51-message remainder falls back.
    let call = 0
    const enqueued: number[] = []
    const env = {
      NOTIFY_QUEUE: {
        sendBatch: async (msgs: unknown[]) => {
          call += 1
          if (call === 1) {
            enqueued.push(msgs.length)
            return
          }
          throw new Error('queue backlog full')
        },
      },
    } as unknown as Env
    const { impl, calls } = fakeFetch(() => ({ ok: true, status: 200 }))
    const webhooks = Array.from({ length: 150 }, (_, i) => ({ url: `https://example.com/${i}` }))
    await notify(env, { delivery: 'queue', slack: { webhookUrl: 'https://hooks.slack.com/services/T/B/X' }, webhooks }, payload, impl)
    expect(enqueued).toEqual([100]) // first chunk queued
    expect(calls).toHaveLength(51) // only the remainder POSTed inline — no double-delivery
  })

  it('routes to inline dispatch for the default (inline) delivery mode', async () => {
    const { env, sent } = queueEnv('record')
    const { impl, calls } = fakeFetch(() => ({ ok: true, status: 200 }))
    await notify(env, { delivery: 'inline', webhooks: [{ url: 'https://example.com/a' }] }, payload, impl)
    // Never touched the queue; POSTed the target directly.
    expect(sent).toHaveLength(0)
    expect(calls.map(c => c.url)).toEqual(['https://example.com/a'])
  })

  it('falls back to inline (with a real POST) when delivery is queue but the binding is missing', async () => {
    const { env } = queueEnv('none')
    const { impl, calls } = fakeFetch(() => ({ ok: true, status: 200 }))
    await notify(env, { delivery: 'queue', webhooks: [{ url: 'https://example.com/a' }] }, payload, impl)
    // The fallback actually dispatched the target rather than silently no-oping.
    expect(calls.map(c => c.url)).toEqual(['https://example.com/a'])
  })

  it('falls back to inline (with a real POST) when the enqueue itself fails', async () => {
    const { env } = queueEnv('throw')
    const { impl, calls } = fakeFetch(() => ({ ok: true, status: 200 }))
    await notify(env, { delivery: 'queue', webhooks: [{ url: 'https://example.com/a' }] }, payload, impl)
    // sendBatch threw → the alert is not dropped; it is delivered inline.
    expect(calls.map(c => c.url)).toEqual(['https://example.com/a'])
  })
})

/** Build a MessageBatch stub whose messages record ack()/retry() calls. */
function batchOf(messages: NotificationMessage[]) {
  const outcomes: ('ack' | 'retry')[] = []
  const batch = {
    messages: messages.map(body => ({
      body,
      ack: () => outcomes.push('ack'),
      retry: () => outcomes.push('retry'),
    })),
  } as unknown as MessageBatch<NotificationMessage>
  return { batch, outcomes }
}

describe('consumeNotificationBatch (queue consumer)', () => {
  it('acks a message that delivers successfully', async () => {
    const { impl } = fakeFetch(() => ({ ok: true, status: 200 }))
    const { batch, outcomes } = batchOf([{ url: 'https://example.com/ok', body: payload }])
    await consumeNotificationBatch(batch, impl)
    expect(outcomes).toEqual(['ack'])
  })

  it('retries a message whose target fails (so Queues re-delivers / dead-letters)', async () => {
    const { impl } = fakeFetch(() => ({ ok: false, status: 503 }))
    const { batch, outcomes } = batchOf([{ url: 'https://example.com/bad', body: payload }])
    await consumeNotificationBatch(batch, impl)
    expect(outcomes).toEqual(['retry'])
  })

  it('retries a message whose delivery throws (network failure)', async () => {
    const { impl } = fakeFetch(() => new Error('network down'))
    const { batch, outcomes } = batchOf([{ url: 'https://example.com/bad', body: payload }])
    await consumeNotificationBatch(batch, impl)
    expect(outcomes).toEqual(['retry'])
  })

  it('swallows a post-delivery ack failure without retrying (no duplicate POST)', async () => {
    const { impl } = fakeFetch(() => ({ ok: true, status: 200 }))
    let retried = false
    const batch = {
      messages: [{
        body: { url: 'https://example.com/ok', body: payload },
        ack: () => { throw new Error('already settled') },
        retry: () => { retried = true },
      }],
    } as unknown as MessageBatch<NotificationMessage>
    // Delivery succeeded, so a failing ack must not escalate to a retry.
    await expect(consumeNotificationBatch(batch, impl)).resolves.toBeUndefined()
    expect(retried).toBe(false)
  })

  it('settles each message independently within a batch', async () => {
    const { impl } = fakeFetch(url =>
      url.includes('/bad') ? { ok: false, status: 500 } : { ok: true, status: 200 },
    )
    const { batch, outcomes } = batchOf([
      { url: 'https://example.com/ok', body: payload },
      { url: 'https://example.com/bad', body: payload },
    ])
    await consumeNotificationBatch(batch, impl)
    expect(outcomes).toEqual(['ack', 'retry'])
  })
})
