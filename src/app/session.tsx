import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import type { SessionMode } from '../domain/types';
import { useLearning } from '../state/LearningProvider';
import { useStudySession, type Feedback } from '../state/useStudySession';
import { Button, Card, Loading, Pill, ProgressBar, Row, Screen, SectionLabel, T, formatPct } from '../ui/components';
import { WordDetails } from '../ui/WordDetails';
import { formatWhen } from '../ui/format';
import { radius, space, type, usePalette } from '../ui/theme';

const MODES: SessionMode[] = ['review', 'learn', 'mixed', 'weak'];
const TITLES: Record<SessionMode, string> = { review: '復習', learn: '新しい単語', mixed: '今日の学習', weak: '苦手を練習' };

export default function SessionScreen() {
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: SessionMode = MODES.includes(params.mode as SessionMode) ? (params.mode as SessionMode) : 'mixed';
  const snap = useLearning();
  if (!snap.ready) return <Loading />;
  return <SessionBody mode={mode} />;
}

function SessionBody({ mode }: { mode: SessionMode }) {
  const c = usePalette();
  const { view, choose, spell, next, busy, error } = useStudySession(mode);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: TITLES[mode] }} />
      <Screen>
        {(view.kind === 'card' || view.kind === 'question') && (
          <View style={{ gap: space.xs }}>
            <ProgressBar value={(view.position - 1) / view.total} />
            <T variant="small" color={c.muted}>
              {view.position} / {view.total}
            </T>
          </View>
        )}
        {error && <T color={c.bad}>{error}</T>}

        {view.kind === 'loading' && <Loading />}

        {view.kind === 'empty' && (
          <Card>
            <T variant="heading">
              {mode === 'learn' ? '今日の新しい単語は終わりです' : mode === 'weak' ? '苦手な単語はありません' : 'いま復習する単語はありません'}
            </T>
            <T color={c.muted}>
              {mode === 'learn'
                ? '1日の目標は設定から変えられます。覚えた単語は、忘れかけたころに復習に出てきます。'
                : '次の復習の時刻になると、ホームに表示されます。'}
            </T>
            <Button label="ホームに戻る" onPress={() => router.back()} />
          </Card>
        )}

        {view.kind === 'card' && (
          <Card>
            <Pill label="NEW" tone="accent" />
            <WordDetails word={view.word} />
            <Button label="覚えた。テストへ" onPress={next} />
          </Card>
        )}

        {view.kind === 'question' && view.question.kind === 'choice' && (
          <ChoiceView
            key={`${view.position}-${view.word.id}`}
            prompt={view.question.prompt}
            detail={view.question.promptDetail}
            isEnglishPrompt={view.question.type === 'en_to_ja_mc'}
            options={view.question.options}
            answerIndex={view.question.answerIndex}
            feedback={view.feedback}
            busy={busy}
            onChoose={choose}
            onNext={next}
          />
        )}

        {view.kind === 'question' && view.question.kind === 'spelling' && (
          <SpellingView
            key={`${view.position}-${view.word.id}`}
            prompt={view.question.prompt}
            detail={view.question.promptDetail}
            hint={view.question.hint}
            feedback={view.feedback}
            busy={busy}
            onSubmit={spell}
            onNext={next}
          />
        )}

        {view.kind === 'done' && (
          <Card>
            <SectionLabel>おつかれさまでした</SectionLabel>
            <Row gap={space.sm} style={{ alignItems: 'baseline' }}>
              <T variant="display">{formatPct(view.summary.firstAttemptAccuracy)}</T>
              <T color={c.muted}>初回の正答率</T>
            </Row>
            <T color={c.muted}>
              {view.summary.wordsStudied} 語・{view.summary.questionsAnswered} 問に解答しました。
            </T>
            {view.summary.missedWordIds.length > 0 && (
              <View style={{ gap: space.xs }}>
                <T variant="heading">間違えた単語</T>
                <MissedList ids={view.summary.missedWordIds} />
                <T variant="small" color={c.muted}>
                  間違えた単語は復習間隔が短くなり、近いうちにまた出ます。
                </T>
              </View>
            )}
            <Button label="ホームに戻る" onPress={() => router.back()} />
          </Card>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function MissedList({ ids }: { ids: string[] }) {
  const snap = useLearning();
  const c = usePalette();
  return (
    <View style={{ gap: 2 }}>
      {ids.map((id) => {
        const w = snap.wordsById.get(id);
        if (!w) return null;
        return (
          <Pressable key={id} onPress={() => router.push(`/word/${id}`)} accessibilityRole="link">
            <T>
              <T variant="heading">{w.word}</T>
              <T color={c.muted}>　{w.senses[0]?.ja}</T>
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

function FeedbackPanel({ feedback, onNext }: { feedback: Feedback; onNext: () => void }) {
  const c = usePalette();
  const p = feedback.progressAfter;
  const schedule =
    p.repetitions === 0
      ? 'もう一度、このあと出題します'
      : p.nextReviewAt
        ? `次の復習: ${formatWhen(p.nextReviewAt)}`
        : '';
  return (
    <View style={[styles.feedback, { backgroundColor: feedback.isCorrect ? c.okSoft : c.badSoft }]} accessibilityLiveRegion="polite">
      <T variant="heading" color={feedback.isCorrect ? c.ok : c.bad}>
        {feedback.isCorrect ? '正解' : feedback.gaveUp ? '答え' : feedback.nearMiss ? 'おしい' : '不正解'}
      </T>
      {!feedback.isCorrect && (
        <T>
          正解: <T variant="heading">{feedback.correctAnswer}</T>
        </T>
      )}
      <WordDetails word={feedback.word} compact />
      <T variant="small" color={c.muted}>
        {schedule}
      </T>
      <Button label="次へ" onPress={onNext} />
    </View>
  );
}

function ChoiceView(props: {
  prompt: string;
  detail: string;
  isEnglishPrompt: boolean;
  options: string[];
  answerIndex: number;
  feedback: Feedback | null;
  busy: boolean;
  onChoose: (i: number | null) => void;
  onNext: () => void;
}) {
  const c = usePalette();
  const [picked, setPicked] = useState<number | null>(null);
  const answered = props.feedback !== null;
  return (
    <View style={{ gap: space.md }}>
      <Card>
        <SectionLabel>{props.isEnglishPrompt ? '意味を選んでください' : '英単語を選んでください'}</SectionLabel>
        <T variant={props.isEnglishPrompt ? 'display' : 'title'}>{props.prompt}</T>
        <T variant="small" color={c.muted}>
          {props.detail}
        </T>
      </Card>
      {props.options.map((opt, i) => {
        const isAnswer = answered && i === props.answerIndex;
        const isWrongPick = answered && picked === i && i !== props.answerIndex;
        return (
          <Pressable
            key={`${i}-${opt}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: answered || props.busy, selected: picked === i }}
            disabled={answered || props.busy}
            onPress={() => {
              setPicked(i);
              props.onChoose(i);
            }}
            style={({ pressed }) => [
              styles.option,
              {
                borderColor: isAnswer ? c.ok : isWrongPick ? c.bad : c.line,
                backgroundColor: isAnswer ? c.okSoft : isWrongPick ? c.badSoft : pressed ? c.surfaceAlt : c.surface,
              },
            ]}
          >
            <T style={props.isEnglishPrompt ? undefined : { fontSize: 19, fontWeight: '600' }}>{opt}</T>
          </Pressable>
        );
      })}
      {!answered && <Button variant="ghost" label="わからない" onPress={() => props.onChoose(null)} disabled={props.busy} />}
      {props.feedback && <FeedbackPanel feedback={props.feedback} onNext={props.onNext} />}
    </View>
  );
}

function SpellingView(props: {
  prompt: string;
  detail: string;
  hint: string;
  feedback: Feedback | null;
  busy: boolean;
  onSubmit: (text: string) => void;
  onNext: () => void;
}) {
  const c = usePalette();
  const [text, setText] = useState('');
  const answered = props.feedback !== null;
  return (
    <View style={{ gap: space.md }}>
      <Card>
        <SectionLabel>つづりを入力してください</SectionLabel>
        <T variant="title">{props.prompt}</T>
        <T variant="small" color={c.muted}>
          {props.detail}
        </T>
        <T style={{ fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), letterSpacing: 1 }} color={c.muted}>
          {props.hint}
        </T>
      </Card>
      <TextInput
        autoFocus
        value={text}
        onChangeText={setText}
        editable={!answered && !props.busy}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="off"
        keyboardType={Platform.OS === 'android' ? 'visible-password' : 'ascii-capable'}
        returnKeyType="done"
        onSubmitEditing={() => !answered && props.onSubmit(text)}
        placeholder="英単語を入力"
        placeholderTextColor={c.muted}
        accessibilityLabel="つづりの入力"
        style={[styles.spellInput, type.title, { borderColor: c.line, color: c.ink, backgroundColor: c.surface }]}
      />
      {!answered && (
        <Row gap={space.sm} style={{ flexWrap: 'nowrap' }}>
          <View style={{ flex: 1 }}>
            <Button variant="ghost" label="わからない" onPress={() => props.onSubmit('')} disabled={props.busy} />
          </View>
          <View style={{ flex: 2 }}>
            <Button label="答える" onPress={() => props.onSubmit(text)} disabled={text.trim().length === 0} loading={props.busy} />
          </View>
        </Row>
      )}
      {props.feedback && <FeedbackPanel feedback={props.feedback} onNext={props.onNext} />}
    </View>
  );
}

const styles = StyleSheet.create({
  option: { borderWidth: 1, borderRadius: radius.md, paddingVertical: space.md, paddingHorizontal: space.lg, minHeight: 54, justifyContent: 'center' },
  feedback: { borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  spellInput: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md },
});
