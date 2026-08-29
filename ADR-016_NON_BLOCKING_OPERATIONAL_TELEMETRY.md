# ADR-016 — Non-blocking Operational Telemetry

**Status:** Accepted  
**Date:** 9 August 2026  
**Deciders:** Danilo Magbual and Codex

## Context

POS speed targets cannot be managed from impressions alone. Monitoring must not add a second critical network dependency to checkout or collect customer, order, payment, PIN, or recipe data.

## Decision

Use a small browser collector that records allow-listed durations and generic error categories in memory. It sends batches asynchronously through an authenticated callable Function. Failure to send telemetry never blocks a sale; a small bounded batch remains in memory for a later retry.

The Function rejects unknown metrics and stores daily aggregates only: count, total milliseconds, maximum milliseconds, failed count, generic error count, and build count. Realtime Database rules make the aggregate node server-write-only.

## Alternatives considered

- Raw event logging: rejected because it creates unnecessary growth and privacy risk.
- Direct browser database writes: rejected because the client could forge or flood monitoring data.
- Third-party monitoring SDK: deferred because it adds cost, payload, another vendor, and broader data collection.

## Consequences

- Startup, POS build, cart render, durable Charge, offline flush, and remote-order arrival can be measured by build and day.
- Average latency is `totalMs / count`; maximum and failure count identify spikes.
- Percentiles are not available from aggregates. Add histogram buckets later only if averages/maxima prove insufficient.
