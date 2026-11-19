# LexiCore

Mobile-first English vocabulary app for Japanese students preparing for highly competitive university entrance exams (Kyoto University, University of Tokyo).

The goal is **long-term retention**, so the core of the app is a reliable spaced-repetition engine. Feature count and study time are secondary.

**Status:** Phase 1 (MVP), Phase 2 (memory optimization) and Phase 3 (AI tutor) are implemented. Phase 4 (forgetting-probability prediction) is not started.

## Web app (recommended): `web/`

The community version of LexiCore is a **Next.js web app** for a small, invite-only group (friends, classmates). Members open a URL in any browser; no App Store, no install. The Expo app in the repository root is the earlier mobile prototype and is no longer the main target.

**Features:** everything in the app below (learning, spaced repetition, progress, AI tutor, dashboard, analytics) plus:
- **Invite-only registration.** Sign-up requires an invite code, checked inside the database. Members create codes on My Page (14 days, 5 people each) and share them as a link or QR code.
- **LP (learning points).** 1 LP the first time a word is mastered. The database awards it, and only for a plausible history: at least 3 correct answers spread over at least 5 days.
- **Leaderboard** (all time / last 7 days). Spending LP does not lower your rank.
- **Shop** of reaction emotes bought with LP (two free ones). Emotes are kept forever.
- **Reactions.** Send owned emotes to other members. Limits: 50 per day, 10 per day to the same person.
- **Profiles** (icon, name, one-line bio, collection, emotes received) and **notifications** (emotes, LP, friends joining).

LP, purchases, reactions and notifications are written only by database functions. Clients cannot change them directly (RLS and column grants; see `supabase/migrations/20261122000000_social.sql`).

### Local mode (no server)

If `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` are not set, the web app runs in **local mode**. No sign-up is needed, and nothing leaves the browser.

- **Works:** learning, spaced repetition, the word list, analytics, and the offline mistake analysis.
- **Works for one person:** LP (1 per newly mastered word) and the emote shop.
- **Needs the server:** the leaderboard, reactions, notifications, invites and AI answers. Those pages explain this.
- Data is stored in that browser only (`localStorage`). It is not synced and is lost if the site data is cleared.

You can deploy to Vercel without any Supabase settings and share the URL. Everyone then studies on their own, and you can add Supabase later.

### Deploy (Supabase + Vercel, free tiers)

1. **Supabase:** create a project. Apply the schema with `supabase link --project-ref <ref>`, `supabase db push` and `supabase db seed`, or run every file in `supabase/migrations/` and then `supabase/seed.sql` in the SQL editor.
2. **First invite code:** the first person has no one to invite them, so create a code in the SQL editor:
   ```sql
   insert into public.invite_codes (code, max_uses) values ('MYCLASS2027', 30);
   ```
3. **Auth settings** (Authentication → URL Configuration): set **Site URL** to your Vercel URL.
   - For the least setup, you can turn off **Confirm email** (Authentication → Providers → Email).
   - With it on, each new member must click a link in an email first.
4. **Vercel:** import the GitHub repository and set **Root Directory** to `web`.
   - Add the environment variables `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the public anon key only).
   - Deploy, then share the URL. Members invite each other from My Page.
5. **Optional, AI tutor:** deploy the Edge Function as described in "Enabling the AI tutor" below. Without it the tutor page shows a "not configured" message; the offline mistake analysis still works.

`web/src/lexicore/` is a generated copy of the platform-independent code in `src/` (scheduler, sessions, sync store, AI contract). Run `npm run shared:sync` after changing that code; CI fails if the copy is stale.

Local development: `cd web && cp .env.example .env.local`, fill in the values, then `npm install` and `npm run dev`.

## Mobile prototype (Expo)

### Quick start

```bash
npm install
npx expo start          # press i / a for a simulator, or scan the QR code with Expo Go
```

### Local mode

Without Supabase settings the app runs in **local mode**:

- It uses the bundled 203-word vocabulary.
- All learning data stays on the device.
- No sign-in is needed.

This is the fastest way to try the app.

### Single-page web version (iPad / Safari, no computer needed)

`npm run web:page` exports the web build and packs it into one self-contained file, `dist/lexicore.html`.
- All JavaScript, the icon font and the images are inlined. The page makes no network requests.
- It can be hosted anywhere and opened in Safari. Use "Add to Home Screen" to launch it like an app.
- It runs in local mode, so progress is stored in that browser only.
- Route code-splitting is disabled on web (`asyncRoutes: false`) so the whole app is in one bundle.
- `src/app/+not-found.tsx` sends unknown URLs to Home, so the page works under any URL path.

### Connecting Supabase (accounts and cloud sync)

1. Create a Supabase project.
2. Apply the schema and the vocabulary.
   - With the Supabase CLI: `supabase link --project-ref <ref>`, then `supabase db push`, then `supabase db seed` (or run `supabase/seed.sql` in the SQL editor).
   - Without the CLI: run `supabase/migrations/20261119000000_init.sql` and then `supabase/seed.sql` in the SQL editor.
3. Copy `.env.example` to `.env` and fill in the project URL and the **anon / publishable** key.
4. Restart `npx expo start`. The app now shows a sign-in screen (email + password).

Only the public anon key goes in the app. Every table is protected by Row Level Security. The `service_role` key and any OpenAI key must never be added to the client.

### Enabling the AI tutor

The AI tutor runs in the `ai-tutor` Supabase Edge Function. The OpenAI key is stored as a server secret.

```bash
supabase db push                                   # includes the Phase 3 migration
supabase secrets set OPENAI_API_KEY=sk-...         # required
supabase secrets set OPENAI_MODEL=gpt-5-mini       # optional (this is the default)
supabase secrets set AI_DAILY_LIMIT=30             # optional: AI requests per user per 24 h
supabase functions deploy ai-tutor
```

Without these steps the app still works. The AI Tutor tab then shows the offline mistake analysis and a dictionary-only comparison, and marks AI as off.

## Checks

| Command | What it checks |
|---|---|
| `npm run typecheck` | TypeScript strict mode, with `noUncheckedIndexedAccess` |
| `npm test` | 146 Jest tests: domain logic, the offline sync store, 120-day simulated learners for adaptive scheduling, and the AI tutor (validation, prompts, server flow, client) |
| `npm run test:db` | 98 database checks against a throwaway local PostgreSQL: RLS isolation, idempotency, ordering safety, immutable history, seed idempotency, AI content and quota rules, invite-only sign-up, LP awards, shop, reactions, notifications |
| `cd web && npm run typecheck && npm run build` | The web app: strict TypeScript and a production build |
| `npm run test:edge` | Deno typecheck and 8 tests of the `ai-tutor` function's HTTP layer and OpenAI client, against a local fake OpenAI server |
| `npm run vocab:check` | The generated vocabulary files match `data/vocabulary.source.json` |
| `npm run shared:check` | The Edge Function's and the web app's copies of the shared code match `src/` |
| `npm run verify` | vocab check, shared-code check, typecheck and unit tests together |

CI (`.github/workflows/ci.yml`) runs all of these checks.

## Architecture

```
src/
  domain/          Pure TypeScript: no React, no I/O. All learning rules live here.
    srs/sm2.ts         SM-2 scheduler (+ interval modifier, late-review credit, fuzz)
    srs/competency.ts  Per-competency schedules, aggregation, legacy upgrade
    srs/progress.ts    Applies one answer to a word's progress and competency scores
    srs/queue.ts       Due queue ordering, new-word order, competency choice
    assessment/        Question generation, grading, response-time → quality
    session.ts         Session planner and state machine (reviews → new words, retries)
    analytics.ts       Dashboard and analytics calculations
    adaptive.ts        Personal response-time thresholds, retention-calibrated interval modifier
    weakness.ts        Automatic weak-word detection with reasons
    ai/                AI tutor logic shared with the Edge Function: contract, prompts,
                       output validation, learner context, mistake analysis, server flow
  services/
    LearningStore.ts   Offline-first state and sync outbox
    TutorService.ts    AI tutor calls with a per-user device cache of answers
  data/
    remote/            Supabase client, API implementation, row ↔ domain mappers
    storage.ts         Key-value storage abstraction (AsyncStorage in the app)
    words.json         Generated bundled vocabulary
  state/               React providers and hooks that connect services to the UI
  ui/                  Presentational components and theme
  app/                 Expo Router screens: tabs Home / Learn / Review / Analytics / AI Tutor / Library
supabase/
  migrations/          Schema, indexes, RLS, submit_review RPC, AI tables
  seed.sql             Generated vocabulary upsert
  functions/ai-tutor/  Edge Function (Deno): auth, OpenAI call, data access
  functions/_shared/   Generated copy of src/domain/ai and its imports (npm run shared:sync)
data/vocabulary.source.json   The one source of vocabulary data
scripts/                      Vocabulary generator, shared-code sync, database and Edge Function test runners
tests/                        Jest tests and SQL tests
```

UI components never contain scheduling or grading logic. They call the domain layer through `useStudySession` and `LearningStore`.

## Spaced repetition

The scheduler is SM-2 (SuperMemo 2) with four adjustments, each covered by tests.

- **Quality from correctness and response time.**
  - Correct and fast is 5, correct is 4, correct but slow is 3.
  - A spelling answer one letter off is 2, a wrong answer is 1, "わからない" (don't know) is 0.
  - Time thresholds differ by question type; spelling allows more time than multiple choice.
- **Failure → relearn in 10 minutes.** A missed word comes back within the same session instead of tomorrow.
- **Ease changes only for learned words.**
  - Missing a word the first time you see it does not permanently shorten its future intervals.
  - Plain SM-2 does shorten them. An end-to-end run showed it marking most new words "difficult" after one session.
- **Early practice does not inflate intervals.** Answering a word correctly before it is due leaves its schedule unchanged.

New words: the session shows every new word's card first, then tests all of them for recognition (英→日), then all for recall (日→英). Each test round is in a shuffled order, so the answer can't be guessed from the card order. A missed word is re-tested a few steps later.

Queue priority:

- Due words are ranked by how overdue they are *relative to their interval*.
- Relearning words and difficult words get a boost.
- Within a review, the word's weakest competency is tested. Spelling is only tested after the word has been recognized correctly once.
- Daily new-word and review limits are set per user.

The LLM is never used for scheduling.

## Phase 2: memory optimization

**Competency-specific scheduling** (`srs/competency.ts`)
- Recognition, recall and spelling each have their own SM-2 schedule, stored in `competency_scores.<c>.srs`.
- The word-level columns are an aggregate. A word is due when its earliest competency is due, and it is "mastered" only when every active competency is.
- A due word gets up to two questions, most overdue competency first. Questions for different words are interleaved so two tests of the same word are spaced apart.
- Spelling is introduced only once another competency has 2 consecutive successes.
- Progress saved before Phase 2 is upgraded on read. The upgrade is lossless and idempotent, and the existing schedule is unchanged.

**Response-time analysis** (`adaptive.ts`)
- After 20 correct answers of a question type, the fast and slow cut-offs used for SM-2 quality follow your own median time, within 0.5× to 2× of the defaults.
- Analytics shows your personal thresholds and a weekly median time trend.

**Automatic weak-word detection** (`weakness.ts`)
- Each word gets a score from five signals: frequent lapses, low ease, low recent accuracy, slow (hesitant) answers, and a gap between competencies (for example "recognizes but can't spell").
- Each weak word is shown with its reasons.
- Home offers a "苦手を集中練習" (focused weak-word practice) session. It tests each weak word's weakest *tested* competency.
- A correct answer before a word is due counts as practice and does not lengthen its schedule. A wrong answer does shorten it.

**Adaptive scheduling**
- **Interval modifier (0.6–1.4)** calibrated from observed retention on *mature* scheduled reviews (interval of 3 days or more), aiming at 90% retention.
  - The update is relative to the modifier that actually produced the data. Each review records `prev_interval` and `applied_modifier` for this, which is also groundwork for Phase 4.
  - A Bayesian prior and damping keep small samples from swinging the schedule.
  - A first version that estimated the modifier from scratch oscillated between its bounds in simulation. The relative, damped version converges.
- **Late reviews**: a successful late review gets credit for half the extra time.
- **Fuzz**: a small deterministic fuzz (±5%) spreads review dates so they don't pile up on one day.

Simulated over 120 days with 60 words and an exponential-forgetting ground truth, averaged over 4 seeds:

| Learner | Plain SM-2 retention | Adaptive retention |
|---|---|---|
| Forgets faster than SM-2 assumes | 83–85% | 90–92% (more reviews) |
| Forgets very quickly | 59% | 75% (modifier at its 0.6 floor) |
| Strong learner | 92–95% | 93–94% (modifier rises above 1) |

For strong learners, 120 days is too short for the longer intervals to reduce the review count (+3–6%). The tests bound that cost; no saving is claimed.

## Phase 3: AI tutor

The tutor never schedules reviews; scheduling stays with SM-2. The dictionary is the factual source, and AI output is validated before it is saved or shown.

**Features** (AI Tutor tab, and "AI講師に聞く" on each word page)
- **解説 (explanation):** nuance, usage, collocations, common mistakes, a memory tip and personal advice based on the learner's own wrong answers.
- **例文 (examples):** three new sentences at the learner's level (proficiency 1–5).
- **似た語と比べる (synonym comparison):** the target word against up to three others. Candidates are words the learner actually confused, near-synonyms in the dictionary, and listed synonyms.
- **練習問題 (exercises):** fill-in-the-blank items. They are practice only and do not change the review schedule.
- **文の中の意味 (meaning in context):** the learner pastes a sentence and gets the word's meaning there. The tutor says whether it matches a dictionary sense.
- **間違いの分析 (mistake analysis):**
  - Deterministic and offline (`ai/mistakes.ts`).
  - Wrong multiple-choice answers are mapped back to the word they belong to, so "chose the meaning of *X* when asked about *Y*" becomes a confusion pair.
  - Wrong spellings are classified: doubled letter, vowel, swapped letters, ending, missing or extra letter.
  - Recommendations are app actions: compare, open word, weak-word session.
  - "AIに学習アドバイスをもらう" sends these facts to the AI for coaching. The AI may only reference words from the analysis.

**How a request is handled** (`ai/tutorCore.ts`, run by the Edge Function)
1. Check the request, and verify the user's session with Supabase Auth.
2. Read the dictionary and the learner's own data with the learner's JWT, so RLS applies.
3. Build the prompt.
   - Dictionary entries are passed as data.
   - The learner context is computed from stored data: level, accuracy by skill, this word's history, recent wrong answers, confusions.
   - A pasted sentence is passed as quoted data that the model must not follow.
4. Reuse a stored answer when nothing relevant changed.
   - The cache key includes the prompt text, so new mistakes produce a new answer.
   - Cache hits do not count toward the limit.
5. Reserve one request against the daily per-user limit, atomically.
6. Call OpenAI with Structured Outputs (strict JSON schema).
7. Validate the output (`ai/validate.ts`).
   - Shape, lengths, Japanese where required, no links or markup.
   - Example sentences must really use the word (inflections allowed).
   - Exercise answers must be a form of the word. Distractors must not be its synonyms or same-group words. Answer positions must vary.
   - A comparison must cover exactly the requested words.
   - Recommendations may only use ids from the analysis.
   - If validation fails, the errors are sent back for one corrected attempt. If that also fails, nothing is saved and the app shows an error.
8. Save only validated content (`ai_generations`) and return it.

**Security**
- Only the server role can write `ai_generations`. Learners can read their own rows only, so a client cannot plant "AI content".
- The usage log is not readable by clients.
- The quota function is not callable by clients.
- Deleting a user deletes their AI data.

**Offline**
- The device keeps the last 50 answers per user. If the network fails, the saved answer is shown and marked as such.
- Before each request the app uploads pending reviews, so personalization uses the latest history.

**Testing note**
- The full path was run in a browser: app → `functions/v1/ai-tutor` → real handler, data access and OpenAI client.
- Supabase and OpenAI were replaced by local fakes, and the fake model returned canned JSON.
- Answer quality from a real OpenAI model has not been evaluated yet.

## Data model

Static vocabulary (`words`) is separate from per-user data. There are four per-user tables:

- `profiles`: the spec's *Users* table, keyed to `auth.users`
- `word_progress`: SM-2 state plus per-competency scores (JSON)
- `reviews`: an append-only answer log with question type, answer, correctness, quality, response time and timestamp
- `study_sessions`

Reliability rules:

- **Every answer is applied on the device first.** It is saved locally and queued in a persistent outbox, so reviews work offline.
- **`submit_review` writes the review and the new progress in one transaction.**
  - It is idempotent, because review IDs are generated on the client and a retry does nothing.
  - It is ordering-safe: an older review that arrives late (for example from a second device) cannot roll the schedule back.
- **Clients cannot change or delete history.**
  - `reviews` is append-only.
  - Words are read-only.
  - Deleting an auth user deletes that user's data.
- **Bad data never blocks the queue.** An operation the server rejects permanently is moved to a dead-letter list, can be re-sent from Settings, and is never silently dropped.
- **Word IDs are deterministic UUIDv5 values derived from the word.** The bundled data and the database always agree, and re-seeding never orphans progress.

### Vocabulary data

`data/vocabulary.source.json` holds 203 words. Each has an English definition, a Japanese meaning, synonyms and a synonym group; the group keeps near-synonyms from appearing together as answer choices.

- The schema already supports IPA, audio, examples, antonyms, collocations, derivatives, etymology and exam tags.
- The current data does not fill those fields yet. The UI hides empty fields.
- All words currently have difficulty 4.
- The definitions were written for this project and should be reviewed against a dictionary before production use.

To change the vocabulary, edit the source file and run `npm run vocab:build`.

## Not implemented yet

- **Listening, sentence-completion, context and production questions.** Types and database checks already allow them.
- **Forgetting-probability prediction.** Phase 4.
- **Audio pronunciation and IPA data.**
- **Password reset and account deletion screens.**
