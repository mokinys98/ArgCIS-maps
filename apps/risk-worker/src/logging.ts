function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function serializeError(
  error: unknown,
  options?: { includeStack?: boolean }
): Record<string, unknown> {
  const includeStack = options?.includeStack ?? false;

  if (error instanceof Error) {
    const serialized: Record<string, unknown> = {
      name: error.name,
      message: error.message
    };

    if (includeStack && error.stack) {
      serialized.stack = error.stack;
    }

    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause !== undefined) {
      serialized.cause = serializeError(cause, options);
    }

    return serialized;
  }

  if (isRecord(error)) {
    const serialized: Record<string, unknown> = {};
    for (const key of [
      "name",
      "message",
      "code",
      "details",
      "hint",
      "status",
      "statusCode",
      "error"
    ]) {
      if (key in error) {
        serialized[key] = error[key];
      }
    }

    if ("cause" in error) {
      serialized.cause = serializeError(error.cause, options);
    }

    if (Object.keys(serialized).length > 0) {
      return serialized;
    }

    return {
      error: safeStringify(error)
    };
  }

  return {
    error: String(error)
  };
}

export function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  const serialized = serializeError(error);
  if (typeof serialized.message === "string") {
    return serialized.message;
  }

  return safeStringify(serialized);
}

export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
