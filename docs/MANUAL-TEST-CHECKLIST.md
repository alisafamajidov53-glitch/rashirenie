# Ручной чек-лист ChannelPilot 0.17.0

Отмечать после `npm run check` и загрузки свежей папки `apps/extension/dist`.
Тесты, требующие Google/AI credentials, выполнять только на отдельном тестовом
канале и не включать секреты в screenshots или bug reports.

## 1. Установка и базовый runtime

- [ ] Расширение загружается в `chrome://extensions` без manifest error.
- [ ] Service worker открывается без необработанных ошибок.
- [ ] Popup, options, YouTube и Studio panel открываются.
- [ ] После Reload расширения старая вкладка предлагает/требует обычное полное
      обновление, новая вкладка сразу получает актуальный content script.
- [ ] В Console нет повторного React root, бесконечного MutationObserver loop или
      повторяющихся одинаковых API requests.

## 2. Google OAuth

- [ ] Невалидный Client ID даёт понятное сообщение.
- [ ] Redirect URI из Connections совпадает с Google Cloud посимвольно.
- [ ] Первый вход запрашивает только read-only YouTube scopes.
- [ ] После входа загружаются channel и videos.
- [ ] Закрытие/повторное открытие браузера восстанавливает connected state.
- [ ] Истёкший token обновляется тихо; при необходимом consent показывается
      “Refresh Google session”, а cached dashboard не исчезает.
- [ ] Sign out очищает session token и данные другого аккаунта не смешиваются.

## 3. Матрица страниц и SPA

Проверить открытие/закрытие панели, верхний realtime widget и отсутствие
перекрытия YouTube controls:

- [ ] `youtube.com/watch`;
- [ ] страница канала;
- [ ] search results;
- [ ] `studio.youtube.com` Content;
- [ ] Upload dialog/details;
- [ ] Edit video details;
- [ ] Analytics;
- [ ] переходы между этими Studio-разделами без reload;
- [ ] browser Back/Forward;
- [ ] после каждого перехода существует один launcher, один panel root и не
      более одного top widget.

## 4. Размер, zoom и accessibility

Для каждого значения zoom 80%, 100%, 125%, 150% и 175%:

- [ ] панель полностью остаётся внутри viewport;
- [ ] header доступен, нижний контент достигается внутренним scroll;
- [ ] drag не переносит панель за края;
- [ ] resize соблюдает minimum/maximum;
- [ ] размер и позиция восстанавливаются после reload;
- [ ] на ширине около 320–520 px панель переходит в безопасный full-screen
      режим, а options использует bottom navigation;
- [ ] Tab/Shift+Tab проходит по controls в логичном порядке;
- [ ] у интерактивных элементов виден focus ring;
- [ ] Escape/Cancel закрывает confirm flow без изменения Studio;
- [ ] reduced motion отключает заметные animations;
- [ ] labels и ARIA names читаются screen reader.

## 5. Темы и настройки

- [ ] Dark, Light и Auto применяются к options, popup и Shadow panel.
- [ ] Auto реагирует на изменение системной темы без reload.
- [ ] Violet/Cyan/Emerald/Coral accents сохраняются.
- [ ] Transparency и Compact/Comfortable density сохраняются.
- [ ] Polling 60/120/300 секунд сохраняется.
- [ ] Notifications и media privacy toggles сохраняются.
- [ ] Export settings не содержит Google Client ID, Gemini, Groq или TwelveLabs
      keys.
- [ ] Import корректной схемы применяет настройки; malformed JSON показывает
      ошибку.
- [ ] Clear cache не удаляет workspace/settings.
- [ ] Reset local data требует подтверждения и очищает workspace.

## 6. Realtime и Analytics

- [ ] Первый новый публичный counter появляется после того, как его вернул API,
      без искусственного ожидания полного 60m окна.
- [ ] Coverage явно показывает неполные 60m/24h/48h окна.
- [ ] После накопления окна 60m, 24h и 48h дают ожидаемые rolling deltas.
- [ ] Одно изменение video и channel counters не суммируется дважды.
- [ ] Временный откат public counter не создаёт отрицательный всплеск.
- [ ] Смена channel/account не использует старую series.
- [ ] Manual refresh обновляет timestamp.
- [ ] Hidden tab не продолжает foreground polling; после возврата refresh
      возобновляется.
- [ ] При offline/401/429/5xx сохраняется последний корректный snapshot и виден
      live/cached/delayed/unavailable status.
- [ ] Traffic sources, countries, devices и subscribed status используют
      фактические Analytics rows.
- [ ] Частичный отказ одной breakdown query не уничтожает весь dashboard.
- [ ] Impressions/CTR и new/returning не показывают случайных чисел.

## 7. Видео, Score и SEO

- [ ] Таблица видео сортируется и ищется.
- [ ] Performance Score показывает total, confidence, веса и источник каждого
      фактора.
- [ ] Недоступный фактор обозначается “—” и исключается из знаменателя.
- [ ] Score повторяем для одинакового input.
- [ ] SEO checklist проверяет title, description, tags, chapters, hashtags,
      thumbnail, captions, language и category.
- [ ] Playlist, end screen, cards и pinned status помечены unknown.

## 8. Competitor Research

- [ ] Поиск работает по channel ID, `@handle`, URL и названию.
- [ ] Ошибка неизвестного канала понятна.
- [ ] Public counters и последние videos совпадают с YouTube API.
- [ ] Видны average/median views, uploads in 30 days, duration/title analysis,
      frequent top-video terms и возможные content gaps.
- [ ] Save/remove competitor сохраняется после reload.
- [ ] Повторный вызов использует cache; Refresh делает force request.

## 9. Idea Generator

- [ ] Для Mixed, Versus, Challenge, Experiment, Documentary, Trend, Evergreen и
      Series создаётся 10 идей.
- [ ] Long/Shorts переключает формат.
- [ ] При подключённом channel prompt учитывает реальные сильные recent videos.
- [ ] Idea score подписан как packaging quality, не demand forecast.
- [ ] Идея сохраняется и переносится в planner.
- [ ] Rate limit/cancel/error не создаёт пустых fake cards.

## 10. Content Planner и reminders

- [ ] Создание, переименование, notes, date и удаление карточки работают.
- [ ] Drag-and-drop меняет idea/draft/scheduled/ready/published status.
- [ ] Поиск фильтрует title/notes/tags.
- [ ] Карточка с датой появляется в Publishing calendar.
- [ ] JSON export → reset → import восстанавливает данные.
- [ ] CSV export сохраняет quotes/newlines/tags; CSV import восстанавливает их.
- [ ] Значения, начинающиеся с `=`, `+`, `-` или `@`, не выполняются формулой
      spreadsheet.
- [ ] Goal create/progress/delete сохраняются.
- [ ] При включённых notifications scheduled item вызывает одно напоминание
      примерно за час, а не повторный spam.

## 11. Comment Assistant

- [ ] Comments загружаются для выбранного собственного video.
- [ ] All/Questions/Negative/Likely spam filters работают повторяемо.
- [ ] Частые слова считаются локально.
- [ ] Каждый reply tone меняет AI instruction.
- [ ] Single draft сохраняется и редактируется.
- [ ] Draft visible обрабатывает не более 10 комментариев последовательно.
- [ ] Clipboard denial показывает ошибку, а не unhandled Promise.
- [ ] “Reply in YouTube” открывает исходный comment.
- [ ] Ни один draft не публикуется автоматически.

## 12. AI Studio и Studio insertion

- [ ] Gemini-only, Groq-only, TwelveLabs-only, Auto и Gemini+Groq modes
      корректно отражают доступные providers.
- [ ] Test keys не выводит ключ полностью.
- [ ] Text analysis выдаёт минимум 10 titles и title scores.
- [ ] Все девять title modes и выбранный tone попадают в результат.
- [ ] Есть full/short description, tags, keywords, hashtags, chapters, pinned
      comment, thumbnail prompt, script outline и Shorts ideas.
- [ ] Cancel text analysis реально прекращает request.
- [ ] History и favorite titles сохраняются.
- [ ] 429 учитывает Retry-After/cooldown, Auto переключает provider без request
      storm.
- [ ] Video/image/audio progress показывает текущий этап.
- [ ] Выбор title/description в Studio открывает preview старого и нового текста.
- [ ] Cancel не меняет поле; Confirm меняет только выбранное поле.
- [ ] При изменившемся DOM значение остаётся доступно для copy.

## 13. Thumbnail Lab

- [ ] Image/video upload, frame strip и precise seek работают.
- [ ] 16:9 экспортирует 1280×720, 9:16 — 1080×1920.
- [ ] Text drag, safe zones, focus, fit, filters, background blur, outline,
      shadow, vignette и flip отражаются в export.
- [ ] Local Diagnostics повторяемо показывает brightness, contrast, saturation,
      detail и technical readability score.
- [ ] Home/Search/Mobile/Sidebar previews используют текущий canvas.
- [ ] UI нигде не обещает рост CTR.
- [ ] При выключенном media privacy AI audit/background disabled.
- [ ] После opt-in AI audit показывает observed/recommendations/composition и
      явно помечен AI estimate.
- [ ] CORS/tainted canvas и unsupported codec дают понятную ошибку.

## 14. Security regression

- [ ] В repository/bundle нет реальных API keys, bearer tokens и client secrets.
- [ ] Console/debug errors редактируют строки, похожие на secrets.
- [ ] Неизвестный runtime message и oversized payload отклоняются.
- [ ] Message с недоверенного sender URL отклоняется.
- [ ] Нет `eval`, model-generated HTML execution или небезопасных external URLs.
- [ ] Media temp assets удаляются после success/error.

## 15. Финальный release gate

- [ ] `npm run lint`;
- [ ] `npm run format:check`;
- [ ] `npm run typecheck`;
- [ ] `npm test`;
- [ ] `npm run build`;
- [ ] `npm run check`;
- [ ] `unzip -t` итогового архива;
- [ ] checksum и версия manifest равны ожидаемой 0.17.0.
