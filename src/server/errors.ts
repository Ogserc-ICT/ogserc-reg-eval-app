import type { ZodError } from "zod";

/** The user lacks the role, or a separation-of-duties rule forbids the action. */
export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do this.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Input failed validation or a business rule; shown to the user. */
export class ValidationError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
    this.name = "ValidationError";
  }

  /**
   * Errors by top-level field. Problems inside a table (e.g. licences[1].expiryDate) are reported
   * under the table's field as "Row 2: ...".
   */
  static fromZod(error: ZodError): ValidationError {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const [field, row] = issue.path;
      if (field === undefined) continue;
      const message = typeof row === "number" ? `Row ${row + 1}: ${issue.message}` : issue.message;
      const list = (fieldErrors[String(field)] ??= []);
      if (!list.includes(message)) list.push(message);
    }
    return new ValidationError("Please correct the highlighted fields.", fieldErrors);
  }
}

export class NotFoundError extends Error {
  constructor(message = "Record not found.") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * The action needs the user's explicit confirmation (SPEC "warn and require confirmation"). The form
 * shows `message` with a checkbox named `field`; resubmitting with it ticked proceeds.
 */
export class ConfirmationRequiredError extends ValidationError {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "ConfirmationRequiredError";
  }
}

/** A workflow action is not allowed yet; `reasons` lists every failing condition (SPEC §4). */
export class BlockedError extends ValidationError {
  constructor(
    message: string,
    readonly reasons: string[],
  ) {
    super(message);
    this.name = "BlockedError";
  }
}
