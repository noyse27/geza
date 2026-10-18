import { createHmac } from 'node:crypto';

export function berlinDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function clientAddress(request: Request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
  );
}

export function isAutomatedView(request: Request) {
  const purpose = `${request.headers.get('purpose') || ''} ${request.headers.get('sec-purpose') || ''}`;
  const agent = request.headers.get('user-agent') || '';
  return (
    /prefetch/i.test(purpose) ||
    !agent ||
    /bot|crawler|spider|preview|facebookexternalhit|slurp|bingpreview|whatsapp|telegram/i.test(agent)
  );
}

export function dailyVisitorHash(request: Request, mediaId: string, secret: string, day = berlinDay()) {
  if (secret.length < 32) throw Error('SESSION_SECRET muss mindestens 32 Zeichen haben.');
  const agent = request.headers.get('user-agent') || 'unknown';
  return createHmac('sha256', secret)
    .update(`${day}:${mediaId}:${clientAddress(request)}:${agent}`)
    .digest('hex');
}
