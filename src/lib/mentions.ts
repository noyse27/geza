export type MentionKind = 'm' | 'r' | 'a';
export type Mention = { start: number; end: number; kind: MentionKind; id: string; label: string };
export type MentionResult = { id: string; label: string; year?: number | null; poster?: string | null };
const token = /\[\[geza:([mra]):([^\]\r\n]+):([^\]\r\n]+)\]\]/g;

export function decodeMentions(body: string) {
  let text = '',
    last = 0;
  const mentions: Mention[] = [];
  for (const match of body.matchAll(token)) {
    try {
      const id = decodeURIComponent(match[2]),
        label = decodeURIComponent(match[3]);
      if (!label || (match[1] === 'm' && !/^[1-9]\d{0,17}$/.test(id))) continue;
      text += body.slice(last, match.index);
      mentions.push({
        start: text.length,
        end: text.length + label.length,
        kind: match[1] as MentionKind,
        id,
        label,
      });
      text += label;
      last = match.index + match[0].length;
    } catch {
      /* Preserve malformed tokens as ordinary text. */
    }
  }
  return { text: text + body.slice(last), mentions };
}

export function encodeMentions(text: string, mentions: Mention[]) {
  let body = '',
    last = 0;
  for (const m of mentions) {
    body +=
      text.slice(last, m.start) +
      `[[geza:${m.kind}:${encodeURIComponent(m.id)}:${encodeURIComponent(text.slice(m.start, m.end))}]]`;
    last = m.end;
  }
  return body + text.slice(last);
}

export function updateMentions(before: string, after: string, mentions: Mention[]) {
  let start = 0,
    oldEnd = before.length,
    newEnd = after.length;
  while (start < oldEnd && start < newEnd && before[start] === after[start]) start++;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return mentions.flatMap((m) => {
    if (m.end <= start) return [m];
    if (m.start >= oldEnd) return [{ ...m, start: m.start + newEnd - oldEnd, end: m.end + newEnd - oldEnd }];
    return [];
  });
}

export function activeMention(text: string, caret: number) {
  const match = /(?:^|[\s(])@([mra])([^@\n\r\[\]]{2,80})$/.exec(text.slice(0, caret));
  if (!match || match[2].trim().length < 2) return null;
  return {
    kind: match[1] as MentionKind,
    query: match[2].trim(),
    start: caret - match[2].length - 2,
    end: caret,
  };
}
