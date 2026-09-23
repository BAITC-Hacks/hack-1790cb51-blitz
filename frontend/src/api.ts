export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch('/api' + path, {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
    })
  } catch {
    throw new Error(
      'Нет соединения с сервером. Убедитесь, что бэкенд запущен, и повторите попытку.',
    )
  }
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new ApiError(
      typeof error?.detail === 'string'
        ? error.detail
        : `Не удалось выполнить запрос (${response.status}). Повторите попытку.`,
      response.status,
    )
  }
  return response.status === 204 ? (undefined as T) : response.json()
}
export const date = (value: string) =>
  new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
export const bytes = (value: number) =>
  value < 1024 * 1024
    ? `${Math.max(1, Math.round(value / 1024))} КБ`
    : `${(value / 1024 / 1024).toFixed(1)} МБ`
