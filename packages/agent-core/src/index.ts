import { z } from 'zod';

const base = {
  eventId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  occurredAt: z.iso.datetime(),
  provider: z.enum(['claude', 'codex', 'manual']),
};
export const agentEventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('agent.started') }).strict(),
  z
    .object({
      ...base,
      type: z.literal('agent.activity'),
      category: z.enum(['editing', 'testing', 'searching', 'other', 'session_available', 'tool_failed']),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('agent.needs_attention'),
      attention: z.enum(['permission', 'input', 'other']),
    })
    .strict(),
  z.object({ ...base, type: z.literal('agent.turn_completed') }).strict(),
  z
    .object({
      ...base,
      type: z.literal('agent.turn_failed'),
      category: z.enum(['rate_limit', 'authentication', 'api', 'other']),
    })
    .strict(),
  z.object({ ...base, type: z.literal('agent.session_ended') }).strict(),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
export type AgentSession = {
  sessionId: string;
  provider: string;
  state: 'idle' | 'working' | 'attention' | 'turn_ended' | 'error' | 'ended';
  lastSeenAt: string;
  toolActivityCount: number;
  verification: 'unknown';
  connection?: 'live' | 'unknown';
};
export type AgentState = { sessions: Record<string, AgentSession>; seen: string[] };
export const createAgentState = (): AgentState => ({ sessions: {}, seen: [] });
export function reduceAgentEvent(state: AgentState, input: AgentEvent): AgentState {
  const parsed = agentEventSchema.safeParse(input);
  if (!parsed.success || state.seen.includes(input.eventId)) return state;
  const event = parsed.data,
    key = `${event.provider}:${event.sessionId}`,
    prior = state.sessions[key];
  const seen = [...state.seen, event.eventId].slice(-2048);
  if (prior && event.occurredAt < prior.lastSeenAt) return { ...state, seen };
  const session: AgentSession = {
    sessionId: event.sessionId,
    provider: event.provider,
    state: prior?.state ?? 'idle',
    lastSeenAt: event.occurredAt,
    toolActivityCount: prior?.toolActivityCount ?? 0,
    verification: 'unknown',
    connection: 'live',
  };
  switch (event.type) {
    case 'agent.started':
      session.state = 'working';
      break;
    case 'agent.activity':
      if (event.category !== 'session_available') {
        session.toolActivityCount++;
        if (!prior || prior.state === 'idle') session.state = 'working';
      }
      break;
    case 'agent.needs_attention':
      session.state = 'attention';
      break;
    case 'agent.turn_completed':
      session.state = 'turn_ended';
      break;
    case 'agent.turn_failed':
      session.state = 'error';
      break;
    case 'agent.session_ended':
      session.state = 'ended';
      break;
  }
  const sessions = { ...state.sessions, [key]: session };
  const keys = Object.keys(sessions).sort((a, b) =>
    sessions[a].lastSeenAt.localeCompare(sessions[b].lastSeenAt),
  );
  for (const key of keys.slice(0, Math.max(0, keys.length - 64))) delete sessions[key];
  return { sessions, seen };
}
export function getSessions(state: AgentState, now = Date.now()): AgentSession[] {
  return Object.values(state.sessions)
    .map(
      (s): AgentSession => ({
        ...s,
        connection: now - Date.parse(s.lastSeenAt) > 120_000 ? 'unknown' : 'live',
      }),
    )
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}
