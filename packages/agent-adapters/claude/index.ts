import { createHmac, randomUUID } from 'node:crypto';
import type { AgentEvent } from '../../agent-core/src/index';

export const CLAUDE_HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd',
] as const;
/** Never copies prompt, transcript, cwd, input, output or error text. Subagent hooks are ignored. */
export function normalizeClaudeHook(input: unknown, secret: string, now = new Date()): AgentEvent | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const p = input as Record<string, unknown>;
  if (typeof p.session_id !== 'string' || p.session_id.length > 256 || !p.session_id || p.agent_id)
    return null;
  const base = {
    eventId: randomUUID(),
    sessionId: createHmac('sha256', secret).update(p.session_id).digest('hex').slice(0, 32),
    provider: 'claude' as const,
    occurredAt: now.toISOString(),
  };
  switch (p.hook_event_name) {
    case 'SessionStart':
      return { ...base, type: 'agent.activity', category: 'session_available' };
    case 'UserPromptSubmit':
      return { ...base, type: 'agent.started' };
    case 'PostToolUse':
      return {
        ...base,
        type: 'agent.activity',
        category: ['Edit', 'Write', 'NotebookEdit'].includes(String(p.tool_name))
          ? 'editing'
          : ['Read', 'Grep', 'Glob', 'WebSearch'].includes(String(p.tool_name))
            ? 'searching'
            : 'other',
      };
    case 'PostToolUseFailure':
      return { ...base, type: 'agent.activity', category: 'tool_failed' };
    case 'PermissionRequest':
      return { ...base, type: 'agent.needs_attention', attention: 'permission' };
    case 'Notification':
      if (p.notification_type === 'permission_prompt')
        return { ...base, type: 'agent.needs_attention', attention: 'permission' };
      if (
        ['idle_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input'].includes(
          String(p.notification_type),
        )
      )
        return { ...base, type: 'agent.needs_attention', attention: 'input' };
      return null;
    case 'Stop':
      return { ...base, type: 'agent.turn_completed' };
    case 'StopFailure':
      return {
        ...base,
        type: 'agent.turn_failed',
        category:
          p.error === 'rate_limit'
            ? 'rate_limit'
            : p.error === 'authentication_failed'
              ? 'authentication'
              : 'api',
      };
    case 'SessionEnd':
      return { ...base, type: 'agent.session_ended' };
    default:
      return null;
  }
}
