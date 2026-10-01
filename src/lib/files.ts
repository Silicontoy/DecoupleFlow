export function downloadFile(content: string | Uint8Array, name: string, mime = 'application/octet-stream') {
  const blob = new Blob([typeof content === 'string' ? content : new Uint8Array(content)], { type: mime });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return; }
  const input = document.createElement('textarea'); input.value = text; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.append(input); input.select();
  const ok = document.execCommand('copy'); input.remove(); if (!ok) throw new Error('浏览器不支持复制，请手动选择文本。');
}
export type LocalInfo = { token: string; projectRoot: string; userHome: string; jevConfigured?: boolean };
export async function localRequest(path: string, body: unknown, info: LocalInfo, signal?: AbortSignal) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DecoupleFlow-Token': info.token }, body: JSON.stringify(body), signal });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '操作未完成。'); return result;
}
