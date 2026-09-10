export interface ChannelConfig {
  readonly workspaceDir: string;
}

export interface AccessPolicy {
  readonly allowedUserId: string;
  readonly channels: ReadonlyMap<string, ChannelConfig>;
}

export function createAccessPolicy(
  allowedUserId: string,
  channelWorkspaces: ReadonlyMap<string, string>,
): AccessPolicy {
  const channels = new Map<string, ChannelConfig>();
  for (const [channelId, workspaceDir] of channelWorkspaces) {
    channels.set(channelId, { workspaceDir });
  }
  return { allowedUserId, channels };
}

export function isAllowed(policy: AccessPolicy, userId: string, channelId: string): boolean {
  return userId === policy.allowedUserId && policy.channels.has(channelId);
}

export function getChannelConfig(policy: AccessPolicy, channelId: string): ChannelConfig | undefined {
  return policy.channels.get(channelId);
}
