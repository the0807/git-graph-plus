import { en } from './en';
import { ko } from './ko';

const dictionaries: Record<string, Record<string, string>> = { en, ko };

class I18n {
  locale = $state('en');
  private dict = $state<Record<string, string>>(en);

  setLocale(loc: string) {
    // Extract language code from locale string (e.g., 'ko-KR' -> 'ko')
    const lang = loc.split('-')[0].split('_')[0].toLowerCase();
    this.locale = lang;
    this.dict = dictionaries[lang] ?? en;
  }

  t(key: string, params?: Record<string, string | number>): string {
    let str = this.dict[key] ?? en[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        str = str.replaceAll(`{${k}}`, String(v));
      }
    }
    return str;
  }
}

export const i18n = new I18n();

export function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params);
}
