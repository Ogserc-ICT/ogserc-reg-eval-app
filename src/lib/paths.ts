/** Only same-site paths like "/submissions/abc" (never "//host" or a full URL); otherwise the fallback. */
export function safeInternalPath(path: string | null | undefined, fallback: string): string {
  return path && /^\/(?!\/)[A-Za-z0-9/_-]*$/.test(path) ? path : fallback;
}
