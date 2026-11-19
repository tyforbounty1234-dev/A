import { Redirect } from 'expo-router';

/**
 * Any unknown URL (e.g. the app opened from a hosted page whose path is not a
 * route) goes to Home instead of showing an error screen.
 */
export default function NotFound() {
  return <Redirect href="/" />;
}
