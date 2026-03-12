type ErrorLevel = "error" | "warning";

interface ErrorContext {
  source: string;
  action?: string;
  [key: string]: unknown;
}

interface FrontendErrorPayload {
  level: ErrorLevel;
  message: string;
  name?: string;
  stack?: string;
  url: string;
  userAgent: string;
  timestamp: string;
  context: ErrorContext;
}

const FRONTEND_ERROR_ENDPOINT = "/api/frontend-errors";

function toPayload(
  error: unknown,
  context: ErrorContext,
  level: ErrorLevel = "error",
): FrontendErrorPayload {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    level,
    message: err.message,
    name: err.name,
    stack: err.stack,
    url: window.location.href,
    userAgent: window.navigator.userAgent,
    timestamp: new Date().toISOString(),
    context,
  };
}

function emitPayload(payload: FrontendErrorPayload) {
  console.error("[frontend_error]", payload);

  try {
    if (!navigator.sendBeacon) return;
    const body = new Blob([JSON.stringify(payload)], {
      type: "application/json",
    });
    navigator.sendBeacon(FRONTEND_ERROR_ENDPOINT, body);
  } catch {
    // Keep logging non-blocking; console output is still preserved.
  }
}

export function logFrontendError(
  error: unknown,
  context: ErrorContext,
  level: ErrorLevel = "error",
) {
  emitPayload(toPayload(error, context, level));
}

export function registerGlobalErrorLogging() {
  window.addEventListener("error", (event) => {
    logFrontendError(event.error ?? event.message, {
      source: "window.error",
      action: "unhandled_exception",
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    logFrontendError(event.reason, {
      source: "window.unhandledrejection",
      action: "unhandled_promise_rejection",
    });
  });
}
