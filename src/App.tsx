import { useTranslation } from 'react-i18next'

export default function App() {
  const { t } = useTranslation()

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-3xl font-bold">{t('appName')}</h1>
      <p className="text-neutral-600">{t('tagline')}</p>
    </main>
  )
}
