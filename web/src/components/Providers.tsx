'use client';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { LearningProvider } from '@/lib/learning';
import { MeProvider } from '@/lib/me';
import { TutorProvider } from '@/lib/tutor';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <LearningProvider>
        <TutorProvider>
          <MeProvider>{children}</MeProvider>
        </TutorProvider>
      </LearningProvider>
    </AuthProvider>
  );
}
