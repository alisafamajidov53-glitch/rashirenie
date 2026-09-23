import type {
  DockMetricId,
  SupportedLanguage,
  WidgetSectionId,
} from "@channelpilot/shared";
import {
  addWidgetEntry,
  DEFAULT_DOCK_METRICS,
  DEFAULT_WIDGET_SECTIONS,
  DOCK_METRIC_IDS,
  dockMetricLabel,
  moveWidgetEntry,
  removeWidgetEntry,
  toggleDockMetric,
  WIDGET_SECTION_IDS,
  widgetSectionHint,
  widgetSectionLabel,
} from "@channelpilot/shared";

function tr(language: SupportedLanguage, ru: string, en: string): string {
  return language === "ru" ? ru : en;
}

/**
 * The dashboard's copy of the on-page widget editor.
 *
 * The widget can be arranged in place, on YouTube, but that editor is only
 * reachable while the widget is showing. Someone who hid it — or removed every
 * block — needs a way back that does not depend on the thing they removed, so
 * the same composition is editable here and saved with the rest of the
 * settings.
 */
export function WidgetCompositionEditor({
  sections,
  dockMetrics,
  language,
  onChange,
}: {
  sections: WidgetSectionId[];
  dockMetrics: DockMetricId[];
  language: SupportedLanguage;
  onChange: (patch: {
    widgetSections?: WidgetSectionId[];
    widgetDockMetrics?: DockMetricId[];
  }) => void;
}) {
  const hidden = WIDGET_SECTION_IDS.filter((id) => !sections.includes(id));
  const isDefault =
    sections.join() === DEFAULT_WIDGET_SECTIONS.join() &&
    dockMetrics.join() === DEFAULT_DOCK_METRICS.join();

  return (
    <div className="widget-composition">
      <section aria-labelledby="widget-sections-title">
        <header>
          <strong id="widget-sections-title">
            {tr(language, "Блоки развёрнутой карточки", "Expanded card blocks")}
          </strong>
          <span>
            {tr(
              language,
              "Порядок сверху вниз. Убранные блоки можно вернуть в любой момент.",
              "Top to bottom. Removed blocks can be brought back at any time.",
            )}
          </span>
        </header>
        <ol className="widget-section-list">
          {sections.map((id, index) => (
            <li key={id}>
              <em aria-hidden="true">{index + 1}</em>
              <span>
                <b>{widgetSectionLabel(id, language)}</b>
                <small>{widgetSectionHint(id, language)}</small>
              </span>
              <span className="widget-section-tools">
                <button
                  type="button"
                  onClick={() =>
                    onChange({ widgetSections: moveWidgetEntry(sections, id, -1) })
                  }
                  disabled={index === 0}
                  aria-label={`${tr(language, "Выше", "Move up")}: ${widgetSectionLabel(id, language)}`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange({ widgetSections: moveWidgetEntry(sections, id, 1) })
                  }
                  disabled={index === sections.length - 1}
                  aria-label={`${tr(language, "Ниже", "Move down")}: ${widgetSectionLabel(id, language)}`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() =>
                    onChange({ widgetSections: removeWidgetEntry(sections, id) })
                  }
                  aria-label={`${tr(language, "Убрать", "Remove")}: ${widgetSectionLabel(id, language)}`}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
          {sections.length === 0 && (
            <li className="widget-section-empty">
              {tr(
                language,
                "Все блоки убраны — карточка покажет только период и подвал.",
                "Every block is removed — the card will show only the period switch and footer.",
              )}
            </li>
          )}
        </ol>
        {hidden.length > 0 && (
          <div className="widget-chip-row" aria-label={tr(language, "Добавить", "Add")}>
            {hidden.map((id) => (
              <button
                type="button"
                key={id}
                onClick={() =>
                  onChange({
                    widgetSections: addWidgetEntry(sections, WIDGET_SECTION_IDS, id),
                  })
                }
              >
                <i aria-hidden="true">+</i>
                {widgetSectionLabel(id, language)}
              </button>
            ))}
          </div>
        )}
      </section>
      <section aria-labelledby="widget-dock-title">
        <header>
          <strong id="widget-dock-title">
            {tr(language, "Метрики в строке YouTube", "Metrics in the YouTube bar")}
          </strong>
          <span>
            {tr(
              language,
              "Ниже 1180 px в строку помещаются первые две — остальные видны в развёрнутой карточке.",
              "Below 1180px the bar fits the first two; the rest stay in the expanded card.",
            )}
          </span>
        </header>
        <div className="widget-chip-row">
          {DOCK_METRIC_IDS.map((id) => {
            const on = dockMetrics.includes(id);
            return (
              <button
                type="button"
                key={id}
                className={on ? "on" : ""}
                aria-pressed={on}
                onClick={() =>
                  onChange({ widgetDockMetrics: toggleDockMetric(dockMetrics, id) })
                }
              >
                <i aria-hidden="true">{on ? "✓" : "+"}</i>
                {dockMetricLabel(id, language)}
              </button>
            );
          })}
        </div>
      </section>
      <footer>
        <button
          type="button"
          className="secondary-button"
          disabled={isDefault}
          onClick={() =>
            onChange({
              widgetSections: [...DEFAULT_WIDGET_SECTIONS],
              widgetDockMetrics: [...DEFAULT_DOCK_METRICS],
            })
          }
        >
          {tr(language, "Вернуть состав по умолчанию", "Reset widget layout")}
        </button>
      </footer>
    </div>
  );
}
