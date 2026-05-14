type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type FetchTextResult =
  | {
      reached: true;
      ok: boolean;
      status: number;
      statusText: string;
      text: string;
    }
  | {
      reached: false;
      error: string;
    };

export async function fetchText(
  url: string,
  init: RequestInit = {},
  timeoutMs = 20_000,
  fetcher: Fetcher = fetch,
): Promise<FetchTextResult> {
  try {
    const response = await fetcher(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
    return {
      reached: true,
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text: await response.text(),
    };
  } catch (error) {
    return {
      reached: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function describeUnreachable(
  label: string,
  baseUrl: string,
  error: string,
): string {
  return `${label} is unreachable at ${baseUrl}. Retry later after the service is running. (${error})`;
}
