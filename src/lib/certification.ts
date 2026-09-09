export function normalizeCertification(raw: string | null | undefined): string | undefined {
  const value = raw?.replace(/^FSK\s*/i, '').trim();
  return value ? `FSK ${value}` : undefined;
}
