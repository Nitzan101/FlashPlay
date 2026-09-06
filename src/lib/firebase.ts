import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { getAuth } from 'firebase/auth'

/**
 * Reads config from env vars rather than hardcoding it, so that pointing a
 * build at the wrong Firebase project (e.g. the live Imposter Game one)
 * requires deliberately editing .env.local rather than being one merge away.
 * None of these values are secret - they run in client code and ship in the
 * bundle. The real access boundary is Firestore security rules (milestone 2).
 */
function readConfig(): FirebaseOptions {
  const env = import.meta.env
  const required = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  }

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase env vars: ${missing.join(', ')}. Copy .env.example to .env.local and fill it in from the Firebase console.`,
    )
  }

  return required as FirebaseOptions
}

export const firebaseApp = initializeApp(readConfig())
export const auth = getAuth(firebaseApp)
