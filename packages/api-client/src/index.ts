export class ApiClient {
  constructor(
    public baseUrl: string,
    public token: () => Promise<string>,
  ) {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname)
    )
      throw new Error("API must use HTTPS");
  }
  async request<T = any>(
    path: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ): Promise<T> {
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/v1${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${await this.token()}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error ?? `Request failed (${response.status})`);
    return data as T;
  }
}
