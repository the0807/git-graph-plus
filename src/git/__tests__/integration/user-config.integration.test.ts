import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitService } from '../../git-service';
import { createTempRepo, runGit, type TempRepo } from './helpers';

describe('GitService integration — user config', () => {
  let repo: TempRepo;
  let svc: GitService;

  beforeEach(() => {
    repo = createTempRepo();
    svc = new GitService(repo.path);
    // Isolate the global/system scopes so global reads are deterministic
    // (otherwise they'd reflect the developer's own ~/.gitconfig).
    svc.setExtraEnv({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' });
  });
  afterEach(() => repo.cleanup());

  it('reads local user.name/user.email', async () => {
    const details = await svc.getUserDetails();
    expect(details.name.local).toBe('Test User');
    expect(details.email.local).toBe('test@example.com');
    expect(details.name.global).toBeNull();
    expect(details.email.global).toBeNull();
  });

  it('returns null for keys that are not set', async () => {
    runGit(repo.path, ['config', '--local', '--unset-all', 'user.name']);
    const details = await svc.getUserDetails();
    expect(details.name.local).toBeNull();
    expect(details.email.local).toBe('test@example.com');
  });

  it('setUserConfig writes to the local scope', async () => {
    await svc.setUserConfig('user.name', 'Jane Doe', 'local');
    await svc.setUserConfig('user.email', 'jane@example.com', 'local');
    const details = await svc.getUserDetails();
    expect(details.name.local).toBe('Jane Doe');
    expect(details.email.local).toBe('jane@example.com');
  });

  it('unsetUserConfig removes the key', async () => {
    await svc.unsetUserConfig('user.name', 'local');
    const details = await svc.getUserDetails();
    expect(details.name.local).toBeNull();
    expect(details.email.local).toBe('test@example.com');
  });

  it('setUserConfig rejects empty and flag-like values', async () => {
    await expect(svc.setUserConfig('user.name', '', 'local')).rejects.toThrow();
    await expect(svc.setUserConfig('user.name', '   ', 'local')).rejects.toThrow();
    await expect(svc.setUserConfig('user.name', '-x', 'local')).rejects.toThrow();
  });
});
