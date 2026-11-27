/** Shared test helpers for the v1.4.5 field / row resolvers. */
import type { CommandContext } from '../types';

export type PhoneCtx = Pick<CommandContext, 'screen' | 'options' | 'fields' | 'expect'>;
export const applyFieldDefaults = (c: PhoneCtx): PhoneCtx => ({ ...c });
