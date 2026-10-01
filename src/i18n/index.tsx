import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { translate, translateSystemMessage, type Language } from './translate';
export { translate, type Language } from './translate';

export const LANGUAGE_STORAGE_KEY = 'decoupleflow.language';
function initialLanguage(): Language {
  try { return localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'zh' ? 'zh' : 'en'; }
  catch { return 'en'; }
}
const LanguageContext = createContext<{ language: Language; setLanguage: (language: Language) => void; t: (message: string, parameters?: Record<string, string | number>) => string; system: (message: string) => string } | null>(null);
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const t = useCallback((message: string, parameters?: Record<string, string | number>) => translate(language, message, parameters), [language]);
  const system = useCallback((message: string) => translateSystemMessage(language, message), [language]);
  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    document.title = language === 'zh' ? 'DecoupleFlow · 状态机工作台' : 'DecoupleFlow · State Machine Studio';
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* The selection still works for this session. */ }
  }, [language]);
  const value = useMemo(() => ({ language, setLanguage, t, system }), [language, t, system]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export function useI18n() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('LanguageProvider is missing.');
  return value;
}
