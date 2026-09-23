import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import {
  redactSecrets,
  safeErrorMessage,
  type SupportedLanguage,
} from "@channelpilot/shared";

interface ErrorBoundaryProps {
  children: ReactNode;
  language?: SupportedLanguage;
  /**
   * Set by the content script. A compact boundary renders as a small fixed
   * card instead of a full-height block, because it lives inside a shadow root
   * attached to a YouTube page rather than owning the viewport.
   */
  compact?: boolean;
  /** Optional hook so a host can drop derived state before the retry. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  /** Where it happened, shown under "Technical details" for bug reports. */
  details: string;
  /** Bumped on every retry to force a full remount of the subtree. */
  generation: number;
}

function safeMessage(error: Error): string {
  return safeErrorMessage(error, "Unknown rendering error", 500);
}

/** First frames of the error and component stacks, secrets redacted. */
function diagnostics(error: Error, componentStack: string | null | undefined): string {
  const frames = (value: string | null | undefined, count: number) =>
    (value ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("at "))
      .slice(0, count);
  return redactSecrets(
    [
      `${error.name}: ${safeMessage(error)}`,
      ...frames(error.stack, 6),
      "— component stack —",
      ...frames(componentStack, 8),
    ].join("\n"),
  );
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, details: "", generation: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged in production too: the fallback message alone ("reading
    // 'length'") cannot be traced to a component. The frames carry bundle
    // file names and positions only; the text is redacted.
    const details = diagnostics(error, info.componentStack);
    console.error("[ChannelPilot] React boundary\n" + details);
    this.setState({ details });
  }

  /**
   * Remounts the subtree instead of reloading the page.
   *
   * The old handler called `window.location.reload()`. In a content script that
   * reloads youtube.com itself: the viewer loses their position in the video
   * and, in Studio, an unsaved upload form. A widget crash must never cost the
   * user the page it is sitting on.
   */
  private readonly retry = (): void => {
    this.props.onReset?.();
    this.setState((current) => ({
      error: null,
      details: "",
      generation: current.generation + 1,
    }));
  };

  override render(): ReactNode {
    const { error, details, generation } = this.state;
    const { compact } = this.props;
    if (!error) {
      // A keyed Fragment, not a wrapper element: bumping the key remounts the
      // subtree without inserting a DOM node that would break the `>` child
      // selectors the stylesheets rely on.
      return <Fragment key={generation}>{this.props.children}</Fragment>;
    }
    const english = this.props.language === "en";
    return (
      <section
        role="alert"
        style={{
          // A compact boundary is pinned like the panel it replaces. Without
          // this the fallback rendered as a full-width block at the end of
          // <html> and pushed a black bar across the YouTube page.
          ...(compact
            ? {
                position: "fixed" as const,
                top: 76,
                right: 16,
                width: 340,
                maxWidth: "calc(100vw - 32px)",
                zIndex: 2147483647,
                borderRadius: 18,
                border: "1px solid #3b3550",
                boxShadow: "0 24px 60px rgba(0, 0, 0, 0.45)",
              }
            : { minHeight: "70vh" }),
          display: "grid",
          placeContent: "center",
          gap: 12,
          padding: compact ? 18 : 24,
          color: "#f8f4ff",
          background: "#0d0c13",
          fontFamily: "Inter, system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <strong style={{ fontSize: compact ? 15 : 18 }}>
          {english
            ? "This interface section could not be rendered"
            : "Этот раздел интерфейса не удалось отобразить"}
        </strong>
        <span
          style={{
            maxWidth: 560,
            color: "#aaa3b8",
            lineHeight: 1.5,
            fontSize: compact ? 13 : 14,
          }}
        >
          {safeMessage(error)}
        </span>
        {details && (
          <details style={{ maxWidth: 560, textAlign: "left", fontSize: 12 }}>
            <summary style={{ cursor: "pointer", color: "#aaa3b8" }}>
              {english ? "Technical details" : "Технические подробности"}
            </summary>
            <pre
              style={{
                margin: "8px 0 0",
                maxHeight: 180,
                overflow: "auto",
                padding: 10,
                borderRadius: 8,
                color: "#d9d3e6",
                background: "#17151f",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                userSelect: "text",
              }}
            >
              {details}
            </pre>
          </details>
        )}
        <button
          type="button"
          style={{
            justifySelf: "center",
            minHeight: 40,
            padding: "10px 16px",
            border: "1px solid #6f58d8",
            borderRadius: 10,
            color: "white",
            background: "#5b43d6",
            cursor: "pointer",
            fontSize: 14,
          }}
          onClick={this.retry}
        >
          {english ? "Restart this section" : "Перезапустить раздел"}
        </button>
      </section>
    );
  }
}
