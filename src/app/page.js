import { Suspense } from 'react';
import LoginForm from './LoginForm';

// The form reads ?next= and ?set=, which must sit behind a Suspense boundary.
export default function Page() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
