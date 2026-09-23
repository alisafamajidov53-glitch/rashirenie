# Технический аудит ChannelPilot 0.15.0

Дата контрольной проверки: 26 июля 2026 года.

## Что проверено

- строгая TypeScript-компиляция shared, extension и API;
- Manifest V3, стабильный extension ID и наличие каждого manifest-ресурса;
- OAuth state/nonce, audience/issuer/expiry, scopes, silent renewal и повтор после 401;
- изоляция Google access token и локальных AI-ключей;
- минутные realtime-снимки, окна 60 минут/24 часа, смена канала и перезагрузка SPA;
- кэш Analytics, single-flight запросы и отмена устаревших ответов;
- Gemini, TwelveLabs и Groq: маршрутизация, fallback, cooldown, лимиты,
  timeout, очистка временных uploads и понятные ошибки quota;
- автоматический анализ загружаемого видео без обязательного заголовка;
- защита мультимодального результата от перезаписи последующим text-only анализом;
- выбор кадра, crop 16:9/9:16, safe area, AI-фон и экспорт превью/видеофрагмента;
- экспорт JSON/CSV и защита CSV от formula injection;
- русская и английская локализация интерфейса и генерации;
- production CORS, server auth, rate limit, body/media limits и temp cleanup;
- production bundle на встроенные секреты, source maps и отсутствующие файлы;
- production dependencies через `npm audit`.

## Закрытые дефекты

- Realtime больше не обнуляется после обновления страницы: сохраняются raw и
  монотонно скорректированные счётчики, кэш патчится минутными снимками.
- Откат публичного viewCount не замораживает дальнейший прирост.
- Снимки разных YouTube-каналов не смешиваются.
- Параллельные popup/options/content запросы не запускают одинаковую полную
  синхронизацию и не перезаписывают новые данные старыми.
- Google-подключение сохраняет признак аккаунта после истечения access token;
  выполняется тихое обновление, повтор запроса после 401 и явный re-auth только
  когда его действительно требует Google.
- AI cooldown теперь переживает перезагрузку YouTube через service-worker RPC,
  хотя `chrome.storage.local` закрыт от content scripts.
- Длинный `Retry-After` не блокирует интерфейс; Auto сразу переходит к
  следующему доступному API.
- Gemini Files и TwelveLabs assets удаляются при успехе, ошибке обработки и
  невалидном ответе.
- Повторные input/change/SPA события одного файла не создают дубли AI-запросов.
- Text debounce не уничтожает уже полученное понимание видео.
- Превью загружается с постоянного `i.ytimg.com`, а не с подписанного `i9`
  URL, вызывавшего CORS; редактор корректно освобождает object URL.
- Любой кадр видео можно выбрать из ленты, таймлайна или точным шагом
  0,1/1 секунду; последний кадр не выходит за seekable duration.
- Редкие fallback-ошибки локализованы и для русского, и для английского UI.

## Контрольный результат

- 7 test files / 32 unit tests — пройдены;
- direct AI integration smoke — пройден, включая restricted-storage RPC;
- shared, extension и API typecheck — пройден;
- shared, extension и API production build — пройден;
- `npm audit --omit=dev --audit-level=low` — 0 известных уязвимостей;
- готовая папка установки: `apps/extension/dist`.

## Внешние ограничения

- Realtime — наблюдаемая разница публичного `viewCount`, а не закрытый realtime
  отчёт YouTube Studio. Полное окно появляется только после 60 минут/24 часов
  непрерывных снимков; задержка обновления самого YouTube также отражается в UI.
- Динамический Web OAuth Client ID не позволяет встроить серверный refresh
  token без отдельного backend/vault. После выхода из Google, отзыва доступа
  или политики безопасности Google может потребовать повторный клик входа.
- Квоты Gemini, Groq и TwelveLabs принадлежат проекту/аккаунту провайдера.
  Расширение показывает cooldown и использует fallback, но не может увеличить
  внешнюю бесплатную квоту.
- YouTube Studio — SPA с меняющимся публичным DOM. Используются несколько
  видимых selector fallback и автоматический remount, однако крупный будущий
  редизайн YouTube может потребовать обновить selectors.
