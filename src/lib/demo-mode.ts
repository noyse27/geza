export const isDemo = () => process.env.GEZA_MODE === 'demo';
export function demoResetMinutes() {
  const value = Number(process.env.DEMO_RESET_MINUTES || 60);
  if (!Number.isInteger(value) || value < 5 || value > 1440)
    throw Error('DEMO_RESET_MINUTES: 5–1440 erforderlich.');
  return value;
}
export const demoBlocked = () =>
  Response.json(
    {
      error:
        'Im Demomodus deaktiviert. Es werden keine Zugangsdaten gespeichert oder externen Dienste aufgerufen.',
    },
    { status: 403 },
  );
