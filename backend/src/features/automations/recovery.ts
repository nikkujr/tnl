export function recoverState(sendStarted: unknown): "UNKNOWN" | "PENDING" {
  return sendStarted ? "UNKNOWN" : "PENDING";
}
export function executionFailure(
  error: { code?: string },
  sendStarted: boolean,
) {
  if (sendStarted) return emailFailure(error);
  return [
    "ER_LOCK_DEADLOCK",
    "ER_LOCK_WAIT_TIMEOUT",
    "ECONNREFUSED",
    "ECONNRESET",
    "PROTOCOL_CONNECTION_LOST",
    "ETIMEDOUT",
  ].includes(error.code ?? "")
    ? "RETRY"
    : "FAILED";
}
export function emailFailure(error: {
  code?: string;
  command?: string;
  responseCode?: number;
  status?: number;
}): "RETRY" | "FAILED" | "UNKNOWN" {
  if (error.responseCode) {
    return error.responseCode >= 400 && error.responseCode < 500
      ? "RETRY"
      : "FAILED";
  }
  if (
    error.status === 503 ||
    error.code === "EAUTH" ||
    error.code === "EENVELOPE"
  )
    return "FAILED";
  if (
    error.command === "CONN" ||
    error.command === "AUTH" ||
    error.code === "ECONNECTION" ||
    error.code === "EDNS"
  )
    return "RETRY";
  return "UNKNOWN";
}
