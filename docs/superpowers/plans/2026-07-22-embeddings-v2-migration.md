# Embeddings v2 migration (text-embedding-004 → gemini-embedding-2)

**Date:** 2026-07-22. **Directive:** Michael: "Can you do the Embedding migration?" — full execution sanctioned (code + backfill + flag sequence). PRD dependency: "Embedding migration must finish before Context Spaces or retrieval-quality experiments are judged."
**Ground truth:** dual-write exists behind `model.embeddingWriteV2` (OFF). `model.embeddingV2Read` is inert on BOTH client and server (zero readers). `scoreSameSpace` exists server-side (functions/src/ai/embeddingV2.js:102), tested, unused. Client query vectors are hardcoded v1 via the `generateEmbedding` callable (v1-only return, no version param). Six client scoring seams consume `entry.embedding` with no space guard (cosine returns 0 on length mismatch — silent, and catastrophic if dims ever coincide). Entry v2 vectors use taskType RETRIEVAL_DOCUMENT; nothing sets RETRIEVAL_QUERY. Backfill script `scripts/backfill-embeddings-v2.js` exists: idempotent, resumable, dry-run, consent-respecting. **Dry run 2026-07-22: 252 entries, 239 to backfill, 13 skipped.** Thread embeddings (threadManager) are a separate v1-space vector store — PINNED v1 this migration (documented), not migrated.

## Execution model
Same as all prior work: main, green batches, implementers never push, adversarial reviews. Controller owns prod execution steps (flags, backfill) — sanctioned directly by Michael.

## Task M1 — server: versioned query embeddings (functions/index.js generateEmbedding callable + functions/src/ai/embeddingV2.js + tests)
- Callable accepts optional `version: 'v1' (default) | 'v2'`. Omitted/`'v1'` → byte-identical current behavior (v1 vector, existing callers unaffected).
- `'v2'` → `generateEmbeddingV2` with **taskType `RETRIEVAL_QUERY`** (asymmetric retrieval pairing with the entries' RETRIEVAL_DOCUMENT — this is the correct Gemini pairing; document it), model via `getModel(db,'embeddingV2')`, consent gate unchanged (`assertAiConsent`), returns `{embedding, space:'v2', model, dim}`; v1 return gains `space:'v1'` additively (existing clients ignore it).
- v2 QUERY cache: distinct keyspace from the document cache — include taskType in the key derivation (`uid+':v2q:'+text`), same owner-scoping.
- Tests: version routing, query-vs-document task types distinct, cache keyspace separation, consent gate on both paths, v1 path unchanged (payload-exactness).

## Task M2 — client: space-aware retrieval (src/services/ai/embeddingSpaces.js NEW + embeddings.js + rag/companionContext.js + rag/index.js + analysis/index.js getSmartChatContext + components/chat/Chat.jsx + nexus/layer1/threadManager.js pin + tests)
- New pure module `embeddingSpaces.js`: `scoreEntrySameSpace(query /* {vector, space} */, entry)` — picks `entry.embeddingV2` when query.space==='v2' AND the entry has it; `entry.embedding` when query.space==='v1'; NEVER cross-space (v2 query + v1-only entry → null score, entry handled per seam policy below); port the server comparator semantics (same-space or nothing), client-side cosine reuse.
- `generateQueryEmbedding(text)` in embeddings.js: reads `getFlag('model.embeddingV2Read')` → requests v1 or v2 from the callable, returns `{vector, space}`. **Dual-space robustness policy (no mid-migration cliff): when the flag is ON, request BOTH v1 and v2 query vectors** (two cheap calls; v1 stays cached server-side) and score each entry in its best available space (v2 preferred when the entry has it, else v1-v1) — no entry becomes invisible regardless of backfill coverage. When OFF: v1 only, current behavior byte-identical.
- Route ALL retrieval seams through the shared scorer: findRelevantMemories, hybridRetrieve, companionContext Tier-4, getSmartChatContext, Chat.jsx. Thresholds unchanged per space (v1 thresholds keep applying to v1 scores; v2 scores use the same thresholds initially — documented assumption, revisit with real data; different models have different similarity distributions, note in runbook).
- threadManager: explicitly PINNED v1 (its own thread.embedding store is v1-space; comment + keep calling the callable with version:'v1' semantics = default). Migration of thread vectors = documented non-goal.
- Tests: same-space-or-nothing (v2 query never scored against v1 vector and vice versa — adversarial equal-dims fixture proving no silent garbage), dual-space fallback (mixed corpus: v2-covered entry scored in v2, uncovered in v1), flag-off byte-identical (spy: callable called once, v1), every seam routed (grep-test or per-seam unit), threshold behavior.

## Task M3 — execution + docs (controller after M1+M2 reviewed, batch pushed, hosting+functions deployed)
1. Flip `model.embeddingWriteV2 = true` in `config/flags` (server dual-write on; additive).
2. Run `scripts/backfill-embeddings-v2.js` for real (ADC creds + secret already verified; script consent-respecting, idempotent, checkpointed). Capture processed/updated/skipped + embeddingMeta.dim from a sample.
3. Verify coverage: re-run with --dry-run (expect updated≈0) + a read-only spot check that v2 dims are consistent and embeddingMeta present.
4. Flip `model.embeddingV2Read = true` (activates the M2 client path on next app load).
5. Retrieval sanity artifact: read-only script comparing v1 vs v2 top-k rankings for 3-5 sample queries against real entries (report only — no pass/fail gate; the runtime UAT remains Michael's).
6. Docs: runbook flag rows corrected (embeddingV2Read now LIVE both sides; scoreSameSpace no longer unused; threshold-distribution caveat; thread-pin note), PROJECT_STATUS standing-checklist item closed, ledger.

Rollback at every step: flags revert independently (write-off stops dual-writes; read-off restores v1-only retrieval); backfilled fields are additive and inert with the read flag off.
