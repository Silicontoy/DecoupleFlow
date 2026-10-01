import { Languages } from 'lucide-react';
import { useI18n, type Language } from '../i18n';

export function LanguageSelector() {
  const { language, setLanguage } = useI18n();
  return <label className="language-selector" title="Language / 语言">
    <Languages size={15} aria-hidden="true" />
    <select aria-label="Language" value={language} onChange={event => setLanguage(event.target.value as Language)}>
      <option value="en">En</option>
      <option value="zh">中</option>
    </select>
  </label>;
}
