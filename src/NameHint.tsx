import { useTranslation } from 'react-i18next'

/** Shown under every field where someone types the name the room will see: the
 *  others have to recognise who is who during the games, so an unfamiliar
 *  nickname defeats the point. */
export default function NameHint() {
  const { t } = useTranslation()
  return <p className="m-0 text-center text-xs text-muted">{t('nameHint')}</p>
}
