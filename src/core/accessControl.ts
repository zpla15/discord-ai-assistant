export interface AccessPolicy {
  readonly allowedUserId: string;
  readonly allowedChannelIds: ReadonlySet<string>;
}

export function createAccessPolicy(allowedUserId: string, allowedChannelIds: readonly string[]): AccessPolicy {
  return { allowedUserId, allowedChannelIds: new Set(allowedChannelIds) };
}

export function isAllowed(policy: AccessPolicy, userId: string, channelId: string): boolean {
  return userId === policy.allowedUserId && policy.allowedChannelIds.has(channelId);
}
