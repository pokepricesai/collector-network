// The five One Piece card categories. Used on filters, chips, and to
// choose which card-page detail sections render (e.g. Leaders show
// life; Characters show power/counter; Events don't show power).

export type OpCardType = 'leader' | 'character' | 'event' | 'stage' | 'don';

export const OP_CARD_TYPES: readonly OpCardType[] = [
  'leader',
  'character',
  'event',
  'stage',
  'don',
] as const;

export const OP_CARD_TYPE_LABEL: Record<OpCardType, string> = {
  leader: 'Leader',
  character: 'Character',
  event: 'Event',
  stage: 'Stage',
  don: 'DON!!',
};

export function normaliseCardType(v: unknown): OpCardType | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim().toLowerCase();
  switch (trimmed) {
    case 'leader':
      return 'leader';
    case 'character':
      return 'character';
    case 'event':
      return 'event';
    case 'stage':
      return 'stage';
    case 'don':
    case 'don!!':
    case 'don !!':
      return 'don';
    default:
      return null;
  }
}
