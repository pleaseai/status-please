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

/** A minimal Env whose NOTIFY_QUEUE records the batches it is sent. */
function queueEnv(withBinding: boolean) {
  const sent: { body: NotificationMessage }[][] = []
  const env = {
    NOTIFY_QUEUE: withBinding
      ? { sendBatch: async (msgs: { body: NotificationMessage }[]) => { sent.push([...msgs]) } }
      : undefined,
  } as unknown as Env
  return { env, sent }
}

describe('notify (transport selection)', () => {
  it('enqueues one message per target when delivery is queue', async () => {
    const { env, sent } = queueEnv(true)
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
  })

  it('does not enqueue when there are no targets', async () => {
    const { env, sent } = queueEnv(true)
    await notify(env, { delivery: 'queue' }, payload)
    expect(sent).toHaveLength(0)
  })

  it('falls back to inline when delivery is queue but the binding is missing', async () => {
    const { env } = queueEnv(false)
    // No targets → the inline fallback builds zero messages and makes no network
    // call; we only need the missing-binding branch to resolve (not throw or
    // silently require a queue). The inline dispatch itself is covered above.
    await expect(notify(env, { delivery: 'queue' }, payload)).resolves.toBeUndefined()
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
