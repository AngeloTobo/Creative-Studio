# Architecture

Creative Studio uses one product-owned contract from browser to storage:

```mermaid
flowchart LR
  UI["Vite + React + TypeScript"] -->|"/api/creative-studio/*"| BFF["Creative Studio Worker/BFF"]
  BFF --> D1["Creative Studio D1"]
  BFF --> R2["Creative Studio R2"]
  BFF -->|"exact allowlist only"| AF["AFDFW capabilities"]
  AF --> GEN["Existing generation workers"]
  D1 --> HIST["DNA, jobs, artifacts, decisions"]
  R2 --> MEDIA["Accepted retained media"]
```

## Ownership

- The frontend owns presentation and interaction only. It imports shared types but no Worker or AFDFW source.
- The BFF owns authentication handoff, validation, capability translation, durable job reconciliation, and media mediation.
- Creative Studio D1 owns project metadata, CreativeDNA in every environment, jobs, artifact history, retained-media pointers, and append-only decisions.
- Creative Studio R2 owns accepted generated media.
- AFDFW provides an approved session plus generation submission/status and temporary media through exact routes.

## CreativeDNA vertical slice

1. A user supplies original intent or a labeled commercial reference.
2. The deterministic compiler normalizes eight shared dimensions and three gravity weights.
3. Commercial identity is retained as provenance but omitted from provider prompts.
4. Saving creates a root or child version without overwriting history.
5. Music and image translations create durable jobs tied to the exact DNA artifact.
6. Completion creates a reviewable artifact with job and DNA lineage.
7. Accept copies remote generated media into Creative Studio R2 before recording the explicit decision; reject and archive record decisions without copying media. None changes AFDFW canonical state.

## Adapters

- `development-local-storage` is deliberately visible and browser-scoped. Its media is a gradient placeholder.
- `creative-studio-bff` is backend-scoped. In Worker development mode, D1 metadata is durable across process restarts while generated media remains a placeholder.
- Production uses the `AFDFW` same-account service binding, dedicated D1/R2 bindings, and Cloudflare Access over `cs.angelotoborg.com/*`.
