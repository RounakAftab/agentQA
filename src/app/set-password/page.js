import { Suspense } from 'react';
import SetPasswordForm from './SetPasswordForm';

export const metadata = { title: 'Set your password — AgentQA' };

// The form reads ?token=, which must sit behind a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <SetPasswordForm />
    </Suspense>
  );
}
