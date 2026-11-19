import type { SessionMode } from '../domain/types';
import { useLearning, useLearningStore } from './LearningProvider';
import { useStudySessionCore } from './studySessionCore';

export type { Feedback, SessionView } from './studySessionCore';

export function useStudySession(mode: SessionMode) {
  return useStudySessionCore(useLearningStore(), useLearning(), mode);
}
