export function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

export function sanitizeFilePart(value: string): string {
  return value
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 180);
}

export function resolveHandleBaseUrl(
  handle: string,
  peerMap: Record<string, string>,
): string {
  const normalized = normalizeHandle(handle);
  if (peerMap[handle]) return peerMap[handle];
  if (peerMap[normalized]) return peerMap[normalized];

  if (!normalized.startsWith("@")) {
    throw new Error(`Invalid handle: ${handle}`);
  }

  const host = normalized.slice(1);
  if (!host.includes(".")) {
    throw new Error(`Cannot resolve handle without domain: ${handle}`);
  }

  return `https://${host}`;
}

export function originFromUrl(rawUrl: string): string {
  return new URL(rawUrl).origin;
}

export function candidateRecipientOrigins(
  request: Request,
  configuredBaseUrl?: string,
): string[] {
  const origins = new Set<string>();
  if (configuredBaseUrl) origins.add(originFromUrl(configuredBaseUrl));

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    origins.add(`${proto}://${forwardedHost}`);
  }

  const host = request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "http";
    origins.add(`${proto}://${host}`);
  }

  origins.add(new URL(request.url).origin);
  return [...origins];
}
