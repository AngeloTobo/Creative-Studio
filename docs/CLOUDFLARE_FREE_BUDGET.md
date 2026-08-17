# Cloudflare free-tier budget

Creative Studio is intentionally configured to use only Cloudflare services available on the free plan. The source check `npm run check:cloudflare-free` fails a release if the request-saving protocol, hourly recovery trigger, bounded Queue retries, or free-tier binding boundary is removed.

## Request budget

The maximum idle/visible baseline is 2,904 Worker invocations per day:

| Source | Maximum cadence | Daily requests |
| --- | ---: | ---: |
| Local Runner unified claim or active heartbeat | once per minute | 1,440 |
| One visible browser while work is active | once per minute | 1,440 |
| Durable recovery trigger | once per hour | 24 |

This is 2.904% of the Workers Free allowance of 100,000 requests per day. It excludes explicit owner actions, actual Queue deliveries, and traffic from any other Worker in the Cloudflare account. A hidden browser tab makes no polling requests, a browser with no active work makes no polling requests, and an idle Queue push consumer does not poll.

One browser snapshot request replaces the former twelve-request fan-out. The Local Runner similarly replaces separate generation claim, training claim, and machine heartbeat polling with one work-claim request. A `429` is surfaced without an automatic browser retry; failed refreshes back off from one minute to five minutes.

The current Cloudflare limits used by this budget are documented in the official [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), and [R2 pricing](https://developers.cloudflare.com/r2/pricing/) pages. Limits are account-wide where Cloudflare specifies that scope, so other applications must be budgeted separately.

## Storage and background work

- D1 remains the durable authority and is kept within its free daily row-read and row-write allowances. The consolidated snapshot avoids repeating the same table reads across separate endpoints.
- R2 retains uploads and every completed result. Acceptance and rejection do not create another media copy.
- Queue retries are capped at three. Active AFDFW reconciliation waits at least one minute, while an empty push consumer performs no empty polling.
- The recovery trigger runs hourly. It repairs missed durable work; it is not the primary job loop.
- No Durable Objects, Cloudflare Workflows, Containers, or Browser Rendering binding is configured.

## Rate-limit response

Cloudflare runtime allowance exhaustion and Cloudflare account-API throttling are different limits. The account API documents a default 1,200 requests per five minutes and can return `429`; Creative Studio does not call that management API at runtime. If the application itself receives a `429`, leave it idle until the Cloudflare window or daily allowance resets, then inspect account analytics for other Workers before increasing any cadence.

Run the guard locally before every release:

```powershell
npm run check:cloudflare-free
```

The full production command includes this guard automatically.
