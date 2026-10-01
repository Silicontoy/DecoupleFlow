import { en } from './messages';
import { exportEn } from './exportMessages';
import { runtimeEn } from './runtimeMessages';
import { systemEn } from './systemMessages';
import { portableEn } from './portableMessages';
import { templateEn } from './templateMessages';
import { listEn } from './listMessages';

export type Language = 'en' | 'zh';
type Parameters = Record<string, string | number | undefined>;
const messages = { ...templateEn, ...portableEn, ...en, ...exportEn, ...runtimeEn, ...systemEn, ...listEn };

// Self-contained so exported Skills and workflow Code nodes can use the same formatter.
export function createTranslator(language: Language, catalog: Record<string, string>) {
  return (message: string, parameters: Parameters = {}) => {
    const trimmed = message.trim();
    const translated = language === 'en' ? (Object.hasOwn(catalog, trimmed) ? catalog[trimmed] : trimmed) : trimmed;
    const text = message.replace(trimmed, () => translated);
    return text.replace(/\{(\w+)\}/g, (match, key: string) => Object.hasOwn(parameters, key) ? String(parameters[key]) : match);
  };
}
export const translator = (language: Language) => createTranslator(language, messages);
export const translate = (language: Language, message: string, parameters?: Parameters) => translator(language)(message, parameters);
export const portableTranslationSource = (language: Language) => `const tr = (${createTranslator.toString()})(${JSON.stringify(language)}, ${JSON.stringify(language === 'en' ? { ...runtimeEn, ...listEn } : {})});`;

const systemPatterns = Object.entries(messages).filter(([key]) => key.length < 1000 && /\{\d+\}/.test(key)).map(([key, value]) => {
  const ids: string[] = [];
  const pattern = key.split(/(\{\d+\})/).map(part => {
    if (/^\{\d+\}$/.test(part)) { ids.push(part.slice(1, -1)); return '([\\s\\S]*?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { pattern: new RegExp(`^${pattern}$`), ids, value };
});
/** Translate a known server diagnostic, preserving interpolated names, paths and evidence. */
export function translateSystemMessage(language: Language, message: string) {
  if (language !== 'en') return message;
  if (Object.hasOwn(messages, message.trim())) return translate(language, message);
  for (const { pattern, ids, value } of systemPatterns) {
    const match = pattern.exec(message);
    if (match) {
      const parameters = Object.fromEntries(ids.map((id, i) => [id, match[i + 1]]));
      return value.replace(/\{(\w+)\}/g, (token, id: string) => Object.hasOwn(parameters, id) ? parameters[id] : token);
    }
  }
  return message;
}
