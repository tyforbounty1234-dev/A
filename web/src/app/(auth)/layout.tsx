import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">{children}</main>;
}
