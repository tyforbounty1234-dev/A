#!/usr/bin/env bash
# Type-checks and tests the ai-tutor Edge Function with Deno.
# Uses `deno` from PATH, or a pinned Deno from npm when it is not installed.
set -euo pipefail
cd "$(dirname "$0")/../supabase/functions/ai-tutor"
if command -v deno >/dev/null 2>&1; then DENO=(deno); else DENO=(npx --yes deno@2.9.6); fi
"${DENO[@]}" check index.ts handler.test.ts
"${DENO[@]}" test --allow-net=127.0.0.1 --allow-read=../../../src --allow-env handler.test.ts
