import { useTranslation } from 'react-i18next'
import { signInWithGoogle, signOutUser, useAuthUser } from './lib/auth'

export default function App() {
  const { t } = useTranslation()
  const { user, loading, redirectError } = useAuthUser()

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-bold">{t('appName')}</h1>
      <p className="text-neutral-600">{t('tagline')}</p>

      {redirectError && (
        <p role="alert" className="text-red-600">
          {t('signInError')}
        </p>
      )}

      {loading ? (
        <p>{t('loading')}</p>
      ) : user ? (
        <div className="flex flex-col items-center gap-2">
          <p>{t('greeting', { name: user.displayName ?? user.email })}</p>
          <button
            type="button"
            onClick={() => void signOutUser()}
            className="rounded-md border border-neutral-300 px-4 py-2"
          >
            {t('signOut')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void signInWithGoogle()}
          className="rounded-md bg-blue-600 px-4 py-2 text-white"
        >
          {t('signInWithGoogle')}
        </button>
      )}
    </main>
  )
}
