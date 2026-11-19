# LexiCore

Mobile-first English vocabulary app for Japanese students preparing for highly competitive university entrance exams (Kyoto University, University of Tokyo).

The goal is **long-term retention**, so the core of the app is a reliable spaced-repetition engine. Feature count and study time are secondary.

**Status:** Phase 1 (MVP) and Phase 2 (memory optimization) are implemented. AI features (Phase 3) are not implemented yet; the AI Tutor tab is a placeholder.

## Quick start

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

### Connecting Supabase (accounts and cloud sync)

1. Create a Supabase project.
2. Apply the schema and the vocabulary.
   - With the Supabase CLI: `supabase link --project-ref <ref>`, then `supabase db push`, then `supabase db seed` (or run `supabase/seed.sql` in the SQL editor).
   - Without the CLI: run `supabase/migrations/20261119000000_init.sql` and then `supabase/seed.sql` in the SQL editor.
3. Copy `.env.example` to `.env` and fill in the project URL and the **anon / publishable** key.
4. Restart `npx expo start`. The app now shows a sign-in screen (email + password).

Only the public anon key goes in the app. Every table is protected by Row Level Security. The `service_role` key and any OpenAI key must never be added to the client.

## Checks

| Command | What it checks |
|---|---|
| `npm run typecheck` | TypeScript strict mode, with `noUncheckedIndexedAccess` |
| `npm test` | 100 Jest tests: domain logic, the offline sync store, and 120-day simulated learners for adaptive scheduling |
| `npm run test:db` | 33 database checks against a throwaway local PostgreSQL: RLS isolation, idempotency, ordering safety, immutable history, seed idempotency |
| `npm run vocab:check` | The generated vocabulary files match `data/vocabulary.source.json` |
| `npm run verify` | vocab check, typecheck and unit tests together |

CI (`.github/workflows/ci.yml`) runs all four checks.

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
  services/
    LearningStore.ts   Offline-first state and sync outbox (the only stateful service)
  data/
    remote/            Supabase client, API implementation, row ↔ domain mappers
    storage.ts         Key-value storage abstraction (AsyncStorage in the app)
    words.json         Generated bundled vocabulary
  state/               React providers and hooks that connect services to the UI
  ui/                  Presentational components and theme
  app/                 Expo Router screens: tabs Home / Learn / Review / Analytics / AI Tutor / Library
supabase/
  migrations/          Schema, indexes, RLS, submit_review RPC
  seed.sql             Generated vocabulary upsert
data/vocabulary.source.json   The one source of vocabulary data
scripts/                      Vocabulary generator, database test runner
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

## Not in Phase 1

- **AI Tutor.** Phase 3. The plan is a Supabase Edge Function that holds the OpenAI key server-side; the app gets no key.
- **Listening, sentence-completion, context and production questions.** Types and database checks already allow them.
- **Forgetting-probability prediction.** Phase 4.
- **Audio pronunciation and IPA data.**
- **Password reset and account deletion screens.**
