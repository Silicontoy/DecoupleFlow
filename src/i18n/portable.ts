import { portableEn } from './portableMessages';
import type { Language } from './translate';

const replacements = Object.entries(portableEn).sort(([a], [b]) => b.length - a.length);
/** Apply only to static source templates before inserting any user-authored content. */
export function localizeStaticTemplate(source: string, language: Language) {
  if (language === 'zh') return source;
  for (const [original, translated] of replacements) source = source.replaceAll(original, translated);
  return source.replace('lang="zh-CN"', 'lang="en"').replaceAll("toLocaleTimeString('zh-CN'", "toLocaleTimeString('en-US'");
}
