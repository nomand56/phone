export async function apiRequest<T>(path: string, method = "GET", body?: object): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(typeof result.message === "string" ? result.message : "This request couldn’t be completed. Try again.");
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}
