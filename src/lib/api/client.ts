export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || "Request failed";
    const details = data?.error?.details && data.error.details !== message ? ` ${data.error.details}` : "";
    throw new Error(`${message}${details}`);
  }
  return data as T;
}
