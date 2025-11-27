import { Env, OAuthState, UserState } from '../types';

export async function getUserState(env: Env, userId: string): Promise<UserState | null> {
  const stub = env.USER_DO.get(env.USER_DO.idFromName(userId));
  return stub.getState();
}

export async function updateUserHatena(env: Env, userId: string, hatena: NonNullable<UserState['hatena']>) {
  const stub = env.USER_DO.get(env.USER_DO.idFromName(userId));
  return stub.updateHatena(hatena);
}

export async function saveUserBlog(env: Env, userId: string, info: { blogId: string; title?: string; url?: string }) {
  const stub = env.USER_DO.get(env.USER_DO.idFromName(userId));
  return stub.saveBlog(info);
}

export async function clearUserHatena(env: Env, userId: string) {
  const stub = env.USER_DO.get(env.USER_DO.idFromName(userId));
  return stub.clearHatena();
}

export async function storeOAuthState(env: Env, key: string, value: OAuthState) {
  const stub = env.OAUTH_STATE_DO.get(env.OAUTH_STATE_DO.idFromName(key));
  await stub.putState(key, value);
}

export async function consumeOAuthState(env: Env, key: string) {
  const stub = env.OAUTH_STATE_DO.get(env.OAUTH_STATE_DO.idFromName(key));
  return stub.takeState(key);
}

export async function deleteOAuthState(env: Env, key: string) {
  const stub = env.OAUTH_STATE_DO.get(env.OAUTH_STATE_DO.idFromName(key));
  await stub.deleteState(key);
}
