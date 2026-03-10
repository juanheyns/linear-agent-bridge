let detectedOrigin = "";

export function captureBaseUrl(host: string): void {
  if (detectedOrigin) return;
  const proto = "https";
  detectedOrigin = `${proto}://${host}`;
}

export function getBaseOrigin(): string {
  return detectedOrigin;
}

/** @deprecated Use getBaseOrigin() and build the full path with agent name. */
export function getBaseUrl(): string {
  return detectedOrigin ? `${detectedOrigin}/plugins/linear/api` : "";
}
