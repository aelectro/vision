/**
 * Message catalogue. Ukrainian is the source of truth; English mirrors it.
 *
 * Keys are flat and namespaced by screen so that a missing translation is a
 * type error rather than a silent fallback at runtime.
 */

export const locales = ['uk', 'en'] as const

export type Locale = (typeof locales)[number]

export const localeNames: Record<Locale, string> = {
  uk: 'Українська',
  en: 'English',
}

const uk = {
  'app.name': 'Vision',

  'nav.camera': 'Камера',
  'nav.gallery': 'Галерея',
  'nav.settings': 'Налаштування',

  'capture.title': 'Що ти бачиш?',
  'capture.shutter': 'Зняти',
  'capture.switchCamera': 'Інша камера',
  'capture.fromFile': 'Обрати файл',
  'capture.describePlaceholder': 'Опиши, що ти тут побачив',
  'capture.permissionDenied': 'Доступ до камери заборонено',
  'capture.permissionHint':
    'Дозволь камеру в налаштуваннях браузера або зроби знімок через кнопку нижче.',
  'capture.unavailable': 'Камера недоступна',
  'capture.starting': 'Вмикаю камеру…',

  'gallery.title': 'Галерея',
  'gallery.empty': 'Тут поки порожньо',
  'gallery.emptyHint': 'Зніми перше фото — і образ зʼявиться тут.',
  'gallery.openCamera': 'Відкрити камеру',

  'vision.original': 'Оригінал',
  'vision.transform': 'Трансформація',
  'vision.video': 'Відео',
  'vision.description': 'Опис',
  'vision.descriptionPlaceholder': 'Що ти тут побачив?',
  'vision.createTransform': 'Створити трансформацію',
  'vision.save': 'Зберегти',
  'vision.delete': 'Видалити',
  'vision.share': 'Поділитися',
  'vision.notFound': 'Такого образу немає',

  'settings.title': 'Налаштування',
  'settings.language': 'Мова',
  'settings.models': 'Моделі',
  'settings.training': 'Навчання',
  'settings.storage': 'Сховище',

  'storage.used': 'Зайнято додатком',
  'storage.available': 'Доступно',
  'storage.persisted': 'Захищено від очищення',
  'storage.persistedYes': 'Так',
  'storage.persistedNo': 'Ні',
  'storage.persistHint':
    'Браузер може видалити збережені фото, якщо не заходити сюди тиждень. Додай сайт на початковий екран — і вони збережуться.',

  'status.pending': 'В черзі',
  'status.working': 'Обробляю',
  'status.ready': 'Готово',
  'status.failed': 'Помилка',

  'common.cancel': 'Скасувати',
  'common.retry': 'Спробувати ще',
  'common.back': 'Назад',
  'common.dismiss': 'Закрити',

  'pwa.updateReady': 'Доступна нова версія',
  'pwa.reload': 'Оновити',
  'pwa.install': 'Встановити',
  'pwa.installOffer': 'Додай Vision на головний екран — працюватиме офлайн.',
  'pwa.installIos': 'Щоб працювало офлайн: «Поділитися» → «На екран «Початок»».',
} as const

export type MessageKey = keyof typeof uk

const en: Record<MessageKey, string> = {
  'app.name': 'Vision',

  'nav.camera': 'Camera',
  'nav.gallery': 'Gallery',
  'nav.settings': 'Settings',

  'capture.title': 'What do you see?',
  'capture.shutter': 'Capture',
  'capture.switchCamera': 'Switch camera',
  'capture.fromFile': 'Choose a file',
  'capture.describePlaceholder': 'Describe what you saw here',
  'capture.permissionDenied': 'Camera access denied',
  'capture.permissionHint':
    'Allow the camera in your browser settings, or take a photo with the button below.',
  'capture.unavailable': 'Camera unavailable',
  'capture.starting': 'Starting the camera…',

  'gallery.title': 'Gallery',
  'gallery.empty': 'Nothing here yet',
  'gallery.emptyHint': 'Take your first photo and the image will show up here.',
  'gallery.openCamera': 'Open the camera',

  'vision.original': 'Original',
  'vision.transform': 'Transformation',
  'vision.video': 'Video',
  'vision.description': 'Description',
  'vision.descriptionPlaceholder': 'What did you see here?',
  'vision.createTransform': 'Create a transformation',
  'vision.save': 'Save',
  'vision.delete': 'Delete',
  'vision.share': 'Share',
  'vision.notFound': 'No such vision',

  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.models': 'Models',
  'settings.training': 'Training',
  'settings.storage': 'Storage',

  'storage.used': 'Used by this app',
  'storage.available': 'Available',
  'storage.persisted': 'Protected from eviction',
  'storage.persistedYes': 'Yes',
  'storage.persistedNo': 'No',
  'storage.persistHint':
    'The browser may delete your saved photos if you do not open this for a week. Add the site to your home screen and they will stay.',

  'status.pending': 'Queued',
  'status.working': 'Working',
  'status.ready': 'Ready',
  'status.failed': 'Failed',

  'common.cancel': 'Cancel',
  'common.retry': 'Try again',
  'common.back': 'Back',
  'common.dismiss': 'Dismiss',

  'pwa.updateReady': 'A new version is available',
  'pwa.reload': 'Reload',
  'pwa.install': 'Install',
  'pwa.installOffer': 'Add Vision to your home screen so it works offline.',
  'pwa.installIos': 'To work offline: Share → Add to Home Screen.',
}

export const messages: Record<Locale, Record<MessageKey, string>> = { uk, en }

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value)
}

/** Picks the best supported locale from the browser's preference list. */
export function detectLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0]
    if (base && isLocale(base)) return base
  }
  return 'en'
}
