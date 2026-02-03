# Service-by-service validation & refinements

## profiles.service.ts [done]

Caching `profile:{uid}` (owner/public) is ideal.

Short TTL + explicit invalidation on:
- profile edits
- photo changes
- location changes
- pause/unpause
- moderation events

### Refinement
Separate keys:
- `profile:public:{uid}`
- `profile:owner:{uid}`

Include a profile version hash or `updatedAt` in the cached value to make stale detection trivial.

Queue backing with cached sets is correct - ensure fallback to DB only on full cache miss, not partial hits.

---

## search.service.ts [done]

Caching `search:{uid}:{name}:{radius}` with a 30-60s TTL is exactly right.

Caching liked/blocked/matched state sets removes the largest query fan-out.

Clearing on like/match/block changes is required and correct.

### Refinement
Normalize the search key:
- round radius values
- canonicalize name filters

Avoid key explosion by hashing filters:
- `search:{uid}:{hash(filters)}`

Treat search cache as **soft**; minor staleness is acceptable.

---

## matches.service.ts [done]

Caching `matches:list:{uid}` is a high-ROI optimization.

Lightweight summaries prevent N+1 profile lookups.

Invalidation points are correct.

### Refinement
Cache ordering separately if sorted by recency:
- `matches:list:{uid}`
- `matches:order:{uid}`

Store only IDs and minimal metadata; hydrate profiles via cached `profile:{uid}`.

---

## chat.service.ts [done]

Thread previews per user plus last-message metadata per thread is standard.

Paging cache avoids reloading entire threads.

Invalidation on send/revive/create is correct.

### Refinement
Messages are append-only, so pages can be cached longer.

Prefer cursor-based paging keys:
- `msgs:{threadId}:before:{cursor}`

Never cache unread counts without strict invalidation; they drift easily.

---

## message-request.service.ts [done]

Caching pending lists and counts per recipient is correct.

Reusing cached sender profiles is efficient.

### Refinement
Split keys:
- `msgreq:pending:list:{uid}`
- `msgreq:pending:count:{uid}`

Count TTL can be shorter than list TTL.

---

## users.service.ts [done]

Caching `user:{uid}` is foundational.

Caching token balances avoids hot ledger reads.

Invalidation points are accurate.

### Refinement
Separate cached fields:
- immutable (email, id)
- mutable (location, tokens)

This reduces full invalidations when only tokens change.

---

## blocks.service.ts [done]

Block and exclusion sets are read constantly.

Caching is mandatory at scale.

### Refinement
Use Redis SETs for O(1) membership checks.

`excl:{a}:{b}` is fine, but consider canonical ordering (`min:max`) to halve key count.

---

## tokens.service.ts [done]

A 30-60s TTL is correct.

Purging on any ledger write is required.

### Refinement
Never allow partial invalidation - always purge all token types for a user on write.

Tokens should be **strongly consistent**; cache is a read optimization only.

---

## notifications.service.ts [done]

Caching push token and `notificationsEnabled` is correct.

Invalidation on update and delete is correct.

### Refinement
TTL can be longer (minutes to hours).

Always fallback to DB on cache miss before sending.

---

## like.service.ts [done]

Cached like sets and hide windows are critical.

Clearing on create and delete is correct.

### Refinement
Prefer Redis SETs over arrays.

Hide windows should include expiry timestamps to self-heal automatically.

---

## redis.service.ts [done]

A `getOrSetJson` helper is exactly what you want.

Standardized key prefixes and TTLs are essential.

Adding jitter is correct.

### Refinement
Add:
- hit/miss counters
- latency timing

Consider a soft lock (`SETNX`) to prevent stampedes on cold keys.

---

## Missing (important) scaling considerations

These are not blockers, but worth adding soon.

### Versioned cache busting
Include a `cacheVersion` per user and bump it on destructive changes.

This avoids chasing dozens of keys on complex writes.

### Read-through fallback discipline
Never partially hydrate from the DB if cache data is incomplete.

Either fully serve from cache or rebuild entirely from the DB.

### Background warmers
On login, pre-warm:
- `profile`
- `user`
- `matches:list`
- `blocks`

This reduces first-screen latency spikes.

---
