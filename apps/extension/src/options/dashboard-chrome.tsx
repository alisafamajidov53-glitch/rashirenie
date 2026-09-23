import { useEffect, useRef, type ReactNode } from "react";
import type { SupportedLanguage } from "@channelpilot/shared";

const tr = (language: SupportedLanguage, ru: string, en: string) =>
  language === "ru" ? ru : en;

function useDismissibleDetails() {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return ref;
}

export function DashboardNavigation({
  items,
  active,
  language,
  onChange,
}: {
  items: Array<{ id: string; label: string; icon: ReactNode }>;
  active: string;
  language: SupportedLanguage;
  onChange: (id: string) => void;
}) {
  const more = useDismissibleDetails();
  const primary = ["overview", "videos", "ai", "thumbnail"];
  const select = (id: string) => {
    if (more.current) more.current.open = false;
    onChange(id);
  };
  const button = (item: (typeof items)[number], extra = false) => (
    <button
      key={item.id}
      className={`${active === item.id ? "active" : ""} ${!extra && !primary.includes(item.id) ? "nav-secondary" : ""}`}
      aria-current={active === item.id ? "page" : undefined}
      data-page={item.id}
      aria-label={item.label}
      title={item.label}
      onClick={() => select(item.id)}
    >
      <i>{item.icon}</i>
      <strong>
        <span className="nav-label-wide">{item.label}</span>
        <span className="nav-label-short">
          {item.id === "videos"
            ? tr(language, "Видео", "Videos")
            : item.id === "thumbnail"
              ? tr(language, "Превью", "Thumbs")
              : item.label}
        </span>
      </strong>
      {item.id === "ai" && <em>AI</em>}
    </button>
  );
  return (
    <nav
      className="dashboard-navigation"
      aria-label={tr(language, "Разделы приложения", "App navigation")}
    >
      <span>{tr(language, "РАБОЧЕЕ ПРОСТРАНСТВО", "WORKSPACE")}</span>
      {items.map((item) => button(item))}
      <details
        ref={more}
        className={`mobile-nav-more ${primary.includes(active) ? "" : "active"}`}
      >
        <summary aria-label={tr(language, "Все разделы", "All sections")}>
          <i aria-hidden="true">•••</i>
          <strong>{tr(language, "Ещё", "More")}</strong>
        </summary>
        <div className="mobile-nav-sheet">
          <span>{tr(language, "Все разделы", "All sections")}</span>
          {items
            .filter((item) => !primary.includes(item.id))
            .map((item) => button(item, true))}
        </div>
      </details>
    </nav>
  );
}

export function DashboardTopbar({
  title,
  status,
  language,
  loading,
  signedIn,
  reauthRequired,
  hasData,
  hasAiResult,
  onLanguage,
  onRefresh,
  onSignOut,
  onSignIn,
  onExport,
  onExportAi,
}: {
  title: string;
  status: string;
  language: SupportedLanguage;
  loading: boolean;
  signedIn: boolean;
  reauthRequired: boolean;
  hasData: boolean;
  hasAiResult: boolean;
  onLanguage: (language: SupportedLanguage) => void;
  onRefresh: () => void;
  onSignOut: () => void;
  onSignIn: () => void;
  onExport: (format: "json" | "videos-csv" | "history-csv") => void;
  onExportAi: () => void;
}) {
  const menu = useDismissibleDetails();
  const run = (action: () => void) => {
    if (menu.current) menu.current.open = false;
    action();
  };
  return (
    <header className="topbar">
      <div className="topbar-title">
        <strong>{title}</strong>
        <span>{status}</span>
      </div>
      <div className="topbar-actions">
        <button
          className="secondary-button topbar-refresh"
          onClick={onRefresh}
          disabled={loading}
          aria-label={tr(language, "Обновить данные", "Refresh data")}
          title={tr(language, "Обновить данные", "Refresh data")}
        >
          <span aria-hidden="true">↻</span>
          <span className="topbar-action-label">
            {tr(language, "Обновить", "Refresh")}
          </span>
        </button>
        {(!signedIn || reauthRequired) && (
          <button className="primary-button" onClick={onSignIn} disabled={loading}>
            {reauthRequired
              ? tr(language, "Обновить Google", "Refresh Google")
              : tr(language, "Войти", "Sign in")}
          </button>
        )}
        <details ref={menu} className="export-menu dashboard-menu">
          <summary
            aria-label={tr(language, "Действия и настройки", "Actions and settings")}
          >
            <span aria-hidden="true">•••</span>
          </summary>
          <div>
            <strong>{tr(language, "Язык интерфейса", "Interface language")}</strong>
            <div
              className="language-toggle"
              role="group"
              aria-label={tr(language, "Язык интерфейса", "Interface language")}
            >
              <button
                className={language === "ru" ? "active" : ""}
                aria-pressed={language === "ru"}
                aria-label="Русский язык"
                onClick={() => onLanguage("ru")}
              >
                RU
              </button>
              <button
                className={language === "en" ? "active" : ""}
                aria-pressed={language === "en"}
                aria-label="English language"
                onClick={() => onLanguage("en")}
              >
                EN
              </button>
            </div>
            {signedIn && (
              <a
                href="https://studio.youtube.com"
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  if (menu.current) menu.current.open = false;
                }}
              >
                YouTube Studio ↗
              </a>
            )}
            {(hasData || hasAiResult) && (
              <strong>{tr(language, "Экспорт", "Export")}</strong>
            )}
            {hasData && (
              <>
                <button onClick={() => run(() => onExport("json"))}>
                  JSON · {tr(language, "вся аналитика", "all analytics")}
                </button>
                <button onClick={() => run(() => onExport("videos-csv"))}>
                  CSV · {tr(language, "видео и рост", "videos & growth")}
                </button>
                <button onClick={() => run(() => onExport("history-csv"))}>
                  CSV · {tr(language, "история 28 дней", "28-day history")}
                </button>
              </>
            )}
            {hasAiResult && (
              <button onClick={() => run(onExportAi)}>
                JSON · {tr(language, "AI-анализ", "AI analysis")}
              </button>
            )}
            {signedIn && (
              <button
                className="menu-signout"
                disabled={loading}
                onClick={() => run(onSignOut)}
              >
                {tr(language, "Выйти", "Sign out")}
              </button>
            )}
          </div>
        </details>
      </div>
    </header>
  );
}
