// Pluralization via the platform Intl.PluralRules — the i18n-correct primitive,
// replacing inline `n === 1 ? … : …` ternaries. English-only for now; when a
// second locale lands, this is the single place locale selection hooks in.
const EN_PLURAL = new Intl.PluralRules("en");

/** Pick the singular/plural form for `n` (English categories: one / other). */
export function plural(n: number, forms: { one: string; other: string }): string {
  return EN_PLURAL.select(n) === "one" ? forms.one : forms.other;
}
