import { redirect } from 'next/navigation';

/**
 * Thin alias so a guessed /signup URL lands somewhere real instead of 404ing.
 * The actual auth UI is the single sign-in/sign-up page at /auth.
 */
export default function SignupPage() {
  redirect('/auth?mode=sign-up');
}
