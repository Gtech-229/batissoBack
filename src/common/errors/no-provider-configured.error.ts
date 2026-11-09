/**
 * A message could not be sent because no real provider exists yet (F-01): the
 * console fakes throw it in production, so the send log records the row as
 * FAILED with this name instead of SENT.
 */
export class NoProviderConfiguredError extends Error {
  override readonly name = 'NoProviderConfiguredError';

  constructor(channel: 'SMS' | 'push') {
    super(`No ${channel} provider is configured`);
  }
}
