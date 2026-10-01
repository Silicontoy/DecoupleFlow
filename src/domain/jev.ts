/** TypeSafe System One HTTP API, verified against api.typesafe.ai/openapi.json. */
export async function requestJev(payload: unknown, apiKey: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  if (!apiKey.trim()) throw new Error('尚未配置 TYPESAFE_API_KEY，可在本地服务环境变量或当前会话中填写。');
  if (/[\r\n]/.test(apiKey) || apiKey.length > 4096) throw new Error('API Key 格式不正确。');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const response = await fetcher('https://api.typesafe.ai/v1/systemone', { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
    if (!response.ok) {
      const reason = response.status === 401 || response.status === 403 ? 'API Key 无效或没有模型权限' : response.status === 429 ? '请求限流，请稍后重试' : `服务返回 HTTP ${response.status}`;
      throw new Error(`Jev ${reason}，当前位置未改变。`);
    }
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) throw new Error('Jev 响应过大，当前位置未改变。');
    try { return JSON.parse(text); } catch { throw new Error('Jev 响应不是有效 JSON，当前位置未改变。'); }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Jev 请求超时，当前位置未改变。');
    if (error instanceof TypeError) throw new Error('无法连接 Jev，请检查本地服务网络。当前位置未改变。');
    throw error;
  } finally { clearTimeout(timer); }
}

export function portableJevSource() { return `export const requestJev = ${requestJev.toString()};\n`; }
