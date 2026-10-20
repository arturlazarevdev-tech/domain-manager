import { ZodError } from "zod";

export class AppError extends Error {
  status: number;
  provider?: string;
  details?: string;
  retryable: boolean;

  constructor(options: {
    message: string;
    status?: number;
    provider?: string;
    details?: string;
    retryable?: boolean;
  }) {
    super(options.message);
    this.name = "AppError";
    this.status = options.status ?? 400;
    this.provider = options.provider;
    this.details = options.details;
    this.retryable = options.retryable ?? false;
  }
}

export class ProviderNotImplementedError extends AppError {
  constructor(provider: string) {
    super({
      message: `${provider} is not implemented yet. The adapter is ready to be added without changing business logic.`,
      status: 501,
      provider,
    });
  }
}

export function errorPayload(error: unknown) {
  if (error instanceof ZodError) {
    return { error: { message: error.issues.map((issue) => issue.message).join("; ") } };
  }
  if (error instanceof AppError) {
    return {
      error: {
        message: error.message,
        provider: error.provider,
        details: error.details,
        retryable: error.retryable,
      },
    };
  }

  if (error instanceof Error) {
    return {
      error: {
        message: "Unexpected error",
        details: error.message,
      },
    };
  }

  return {
    error: {
      message: "Unexpected error",
    },
  };
}

export function jsonError(error: unknown, fallbackStatus = 500) {
  const status = error instanceof ZodError ? 400 : error instanceof AppError ? error.status : fallbackStatus;
  return Response.json(errorPayload(error), { status });
}

export function detailedErrorMessage(error: unknown, fallback: string) {
  if (error instanceof AppError && error.details && error.details !== error.message) {
    return `${error.message}: ${error.details}`;
  }
  return error instanceof Error ? error.message : fallback;
}
