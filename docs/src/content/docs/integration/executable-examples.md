---
title: Executable documentation examples
description: Convention for safe documentation smoke tests.
---

Only code fences explicitly marked `chronostar-smoke` are eligible for
automated execution. Each marked example must use a deterministic fixture or a
local sandbox; it must not require a wallet secret, access a public network, or
perform a state-changing transaction.

Keep the source page and example name in the smoke-test failure message. CLI
examples that require chain interaction are documentation-only unless they name
an explicit local-sandbox target. This makes the default documentation check
safe while allowing selected SDK examples to be imported into a future
fixture-backed smoke harness.
