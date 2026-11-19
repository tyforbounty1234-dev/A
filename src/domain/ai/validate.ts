/**
 * Validation of AI output before it is saved or shown. Pure.
 *
 * Checks are structural (shape, lengths, enums) and factual against the
 * dictionary: examples must actually use the target word, exercise answers
 * must be a form of the target and distractors must not be its synonyms,
 * comparisons must cover exactly the requested words, mistake analysis may only
 * reference words from the analysis. Anything that fails is rejected; the error
 * list is fed back to the model for one retry.
 */
import type { Word } from '../types';
import type {
  CompareContent,
  ContextContent,
  ExamplesContent,
  ExercisesContent,
  ExplainContent,
  MistakesContent,
  TutorContentByKind,
  TutorKind,
  TutorRequest,
} from './contract';
import { hasJapanese, hasLinkOrMarkup, isFormOf, usesWord, wordCount } from './lexical';
import type { MistakeAnalysis } from './mistakes';

export type ValidationResult<K extends TutorKind> = { ok: true; content: TutorContentByKind[K] } | { ok: false; errors: string[] };

export interface ValidationContext {
  request: TutorRequest;
  target: Word | null;
  others: Word[];
  otherNames: string[];
  /** All dictionary words, for distractor checks. */
  words: readonly Word[];
  analysis: MistakeAnalysis;
}

class Checker {
  errors: string[] = [];
  fail(msg: string): void {
    if (this.errors.length < 20) this.errors.push(msg);
  }
  text(v: unknown, path: string, opts: { min?: number; max: number; ja?: boolean; en?: boolean }): string {
    if (typeof v !== 'string') {
      this.fail(`${path} must be a string`);
      return '';
    }
    const s = v.replace(/\s+/g, ' ').trim();
    if (s.length < (opts.min ?? 1)) this.fail(`${path} is too short`);
    if (s.length > opts.max) this.fail(`${path} is longer than ${opts.max} characters`);
    if (hasLinkOrMarkup(s)) this.fail(`${path} must not contain links or markup`);
    if (opts.ja && s.length > 0 && !hasJapanese(s)) this.fail(`${path} must be written in Japanese`);
    if (opts.en && hasJapanese(s)) this.fail(`${path} must be English only`);
    return s;
  }
  list<T>(v: unknown, path: string, min: number, max: number, each: (x: unknown, p: string) => T): T[] {
    if (!Array.isArray(v)) {
      this.fail(`${path} must be an array`);
      return [];
    }
    if (v.length < min || v.length > max) this.fail(`${path} must have ${min}–${max} items (got ${v.length})`);
    return v.slice(0, max).map((x, i) => each(x, `${path}[${i}]`));
  }
  obj(v: unknown, path: string): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v)) {
      this.fail(`${path} must be an object`);
      return {};
    }
    return v as Record<string, unknown>;
  }
}

function englishSentence(c: Checker, v: unknown, path: string, word: Word | null, min: number, max: number): string {
  const s = c.text(v, path, { max: 300, en: true });
  if (!s) return s;
  const n = wordCount(s);
  if (n < min || n > max) c.fail(`${path} must be ${min}–${max} words (got ${n})`);
  if (!/[.!?]["')]?$/.test(s)) c.fail(`${path} must end with punctuation`);
  if (word && !usesWord(s, word)) c.fail(`${path} must use "${word.word}" (or an inflected form)`);
  return s;
}

function explain(c: Checker, raw: unknown, ctx: ValidationContext): ExplainContent {
  const o = c.obj(raw, 'output');
  const w = ctx.target!;
  return {
    nuanceJa: c.text(o.nuanceJa, 'nuanceJa', { min: 10, max: 400, ja: true }),
    usageJa: c.list(o.usageJa, 'usageJa', 1, 4, (x, p) => c.text(x, p, { max: 200, ja: true })),
    collocations: c.list(o.collocations, 'collocations', 1, 5, (x, p) => {
      const e = c.obj(x, p);
      const en = c.text(e.en, `${p}.en`, { max: 60, en: true });
      if (en && !usesWord(en, w)) c.fail(`${p}.en must contain "${w.word}"`);
      return { en, ja: c.text(e.ja, `${p}.ja`, { max: 60, ja: true }) };
    }),
    pitfallsJa: c.list(o.pitfallsJa, 'pitfallsJa', 0, 3, (x, p) => c.text(x, p, { max: 200, ja: true })),
    memoryTipJa: c.text(o.memoryTipJa, 'memoryTipJa', { max: 200, ja: true }),
    personalAdviceJa: c.text(o.personalAdviceJa, 'personalAdviceJa', { max: 250, ja: true }),
  };
}

function examples(c: Checker, raw: unknown, ctx: ValidationContext): ExamplesContent {
  const o = c.obj(raw, 'output');
  const items = c.list(o.examples, 'examples', 2, 5, (x, p) => {
    const e = c.obj(x, p);
    return {
      en: englishSentence(c, e.en, `${p}.en`, ctx.target, 6, 35),
      ja: c.text(e.ja, `${p}.ja`, { max: 150, ja: true }),
      noteJa: c.text(e.noteJa, `${p}.noteJa`, { max: 150, ja: true }),
    };
  });
  const seen = new Set<string>();
  for (const [i, e] of items.entries()) {
    const k = e.en.toLowerCase();
    if (seen.has(k)) c.fail(`examples[${i}] duplicates another example`);
    seen.add(k);
    if (ctx.target?.examples.some((d) => d.en.toLowerCase() === k)) c.fail(`examples[${i}] copies a dictionary example`);
  }
  return { examples: items };
}

function compare(c: Checker, raw: unknown, ctx: ValidationContext): CompareContent {
  const o = c.obj(raw, 'output');
  const expected = [ctx.target!, ...ctx.others];
  const expectedNames = [...expected.map((w) => w.word.toLowerCase()), ...ctx.otherNames.map((n) => n.toLowerCase())];
  const items = c.list(o.items, 'items', expectedNames.length, expectedNames.length, (x, p) => {
    const e = c.obj(x, p);
    const word = c.text(e.word, `${p}.word`, { max: 40, en: true });
    const entry = expected.find((w) => w.word.toLowerCase() === word.toLowerCase());
    const pseudo: Word | null = entry ?? (word ? ({ word, spellingVariants: [] } as unknown as Word) : null);
    const ex = c.obj(e.example, `${p}.example`);
    return {
      word,
      coreJa: c.text(e.coreJa, `${p}.coreJa`, { max: 80, ja: true }),
      nuanceJa: c.text(e.nuanceJa, `${p}.nuanceJa`, { max: 250, ja: true }),
      example: { en: englishSentence(c, ex.en, `${p}.example.en`, pseudo, 5, 30), ja: c.text(ex.ja, `${p}.example.ja`, { max: 150, ja: true }) },
    };
  });
  const got = items.map((i) => i.word.toLowerCase());
  const missing = expectedNames.filter((n) => !got.includes(n));
  const extra = got.filter((n) => !expectedNames.includes(n));
  if (missing.length) c.fail(`items is missing: ${missing.join(', ')}`);
  if (extra.length) c.fail(`items contains words that were not requested: ${extra.join(', ')}`);
  return {
    items,
    differenceJa: c.text(o.differenceJa, 'differenceJa', { min: 10, max: 400, ja: true }),
    tipJa: c.text(o.tipJa, 'tipJa', { max: 250, ja: true }),
  };
}

function context(c: Checker, raw: unknown, ctx: ValidationContext): ContextContent {
  const o = c.obj(raw, 'output');
  if (typeof o.matchesDictionarySense !== 'boolean') c.fail('matchesDictionarySense must be a boolean');
  const paraphraseEn = c.text(o.paraphraseEn, 'paraphraseEn', { max: 400, en: true });
  return {
    meaningJa: c.text(o.meaningJa, 'meaningJa', { max: 80, ja: true }),
    explanationJa: c.text(o.explanationJa, 'explanationJa', { min: 10, max: 400, ja: true }),
    matchesDictionarySense: o.matchesDictionarySense === true,
    paraphraseEn,
  };
}

const BLANK = /_{3,}/g;

function exercises(c: Checker, raw: unknown, ctx: ValidationContext): ExercisesContent {
  const o = c.obj(raw, 'output');
  const w = ctx.target!;
  const synonymNames = new Set(w.synonyms.map((s) => s.toLowerCase()));
  const sameGroup = new Set(
    w.synonymGroup ? ctx.words.filter((x) => x.id !== w.id && x.synonymGroup === w.synonymGroup).map((x) => x.word.toLowerCase()) : [],
  );
  const answerPositions = new Set<number>();
  const items = c.list(o.items, 'items', 2, 5, (x, p) => {
    const e = c.obj(x, p);
    let sentence = c.text(e.sentence, `${p}.sentence`, { max: 300, en: true });
    const blanks = sentence.match(BLANK)?.length ?? 0;
    if (blanks !== 1) c.fail(`${p}.sentence must contain exactly one blank "____" (got ${blanks})`);
    sentence = sentence.replace(BLANK, '____');
    if (usesWord(sentence, w)) c.fail(`${p}.sentence must not contain the answer outside the blank`);
    const options = c.list(e.options, `${p}.options`, 4, 4, (y, q) => c.text(y, q, { max: 40, en: true }));
    const lower = options.map((s) => s.toLowerCase());
    if (new Set(lower).size !== lower.length) c.fail(`${p}.options must be different from each other`);
    const answerIndex = e.answerIndex;
    if (typeof answerIndex !== 'number' || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) {
      c.fail(`${p}.answerIndex must be an index into options`);
    } else {
      answerPositions.add(answerIndex);
      if (!isFormOf(options[answerIndex] ?? '', w)) c.fail(`${p}.options[answerIndex] must be "${w.word}" or an inflected form`);
      options.forEach((opt, i) => {
        if (i === answerIndex) return;
        const l = opt.toLowerCase();
        if (isFormOf(opt, w)) c.fail(`${p}.options[${i}] is also a form of the answer`);
        if (synonymNames.has(l) || sameGroup.has(l)) c.fail(`${p}.options[${i}] ("${opt}") is a synonym of the answer, so the item is ambiguous`);
      });
    }
    return {
      sentence,
      options,
      answerIndex: typeof answerIndex === 'number' ? answerIndex : 0,
      explanationJa: c.text(e.explanationJa, `${p}.explanationJa`, { min: 5, max: 300, ja: true }),
    };
  });
  if (items.length >= 3 && answerPositions.size === 1) c.fail('answerIndex is the same for every item; vary the position');
  return { items };
}

function mistakes(c: Checker, raw: unknown, ctx: ValidationContext): MistakesContent {
  const o = c.obj(raw, 'output');
  const a = ctx.analysis;
  const allowed = new Set<string>([
    ...a.confusions.flatMap((x) => [x.wordId, x.confusedWithId]),
    ...a.spelling.map((x) => x.wordId),
    ...a.gaveUp.map((x) => x.wordId),
  ]);
  const pairs = new Set(a.confusions.map((x) => [x.wordId, x.confusedWithId].sort().join('|')));
  const ids = (v: unknown, p: string) =>
    c.list(v, p, 0, 6, (x, q) => {
      const id = typeof x === 'string' ? x : '';
      if (!allowed.has(id)) c.fail(`${q} is not a word id from MISTAKE_FACTS`);
      return id;
    });
  return {
    summaryJa: c.text(o.summaryJa, 'summaryJa', { min: 10, max: 400, ja: true }),
    insights: c.list(o.insights, 'insights', 0, 4, (x, p) => {
      const e = c.obj(x, p);
      return {
        titleJa: c.text(e.titleJa, `${p}.titleJa`, { max: 60, ja: true }),
        detailJa: c.text(e.detailJa, `${p}.detailJa`, { max: 300, ja: true }),
        wordIds: ids(e.wordIds, `${p}.wordIds`),
      };
    }),
    recommendations: c.list(o.recommendations, 'recommendations', 1, 4, (x, p) => {
      const e = c.obj(x, p);
      const action = e.action;
      const wordIds = ids(e.wordIds, `${p}.wordIds`);
      if (action === 'compare') {
        if (wordIds.length !== 2 || !pairs.has([...wordIds].sort().join('|'))) c.fail(`${p}: "compare" needs the 2 ids of one confusion`);
      } else if (action === 'review_word') {
        if (wordIds.length !== 1) c.fail(`${p}: "review_word" needs exactly 1 id`);
      } else if (action === 'weak_session') {
        if (wordIds.length !== 0) c.fail(`${p}: "weak_session" takes no ids`);
      } else c.fail(`${p}.action must be compare, review_word or weak_session`);
      return {
        action: action as MistakesContent['recommendations'][number]['action'],
        wordIds,
        reasonJa: c.text(e.reasonJa, `${p}.reasonJa`, { max: 200, ja: true }),
      };
    }),
  };
}

const VALIDATORS: { [K in TutorKind]: (c: Checker, raw: unknown, ctx: ValidationContext) => TutorContentByKind[K] } = {
  explain,
  examples,
  compare,
  context,
  exercises,
  mistakes,
};

export function validateTutorOutput<K extends TutorKind>(kind: K, raw: unknown, ctx: ValidationContext): ValidationResult<K> {
  if (kind !== 'mistakes' && !ctx.target) return { ok: false, errors: ['missing target word'] };
  const c = new Checker();
  const content = VALIDATORS[kind](c, raw, ctx);
  return c.errors.length ? { ok: false, errors: c.errors } : { ok: true, content };
}
