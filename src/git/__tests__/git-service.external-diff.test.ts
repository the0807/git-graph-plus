import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { GitService, GitError } from '../git-service';

// `git difftool` hands the comparison to a GUI tool and git stays alive until
// that tool exits. GitService.openExternalDiff must therefore spawn it detached
// and return as soon as the process has launched, never awaiting 'close'.
// Driving the spawned process by hand (same pattern as
// git-service.exec.test.ts) pins the argument construction, the
// first-parent / empty-tree base resolution, and the non-blocking contract.
import * as childProcess from 'child_process';
vi.mock('child_process', () => ({ spawn: vi.fn() }));

function fakeProc() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
    unref: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: vi.fn(), end: vi.fn() };
  proc.kill = vi.fn();
  proc.unref = vi.fn();
  return proc;
}

const spawnMock = vi.mocked(childProcess.spawn);

describe('GitService.openExternalDiff', () => {
  let service: GitService;
  let proc: ReturnType<typeof fakeProc>;
  let spawnArgs: string[];

  beforeEach(() => {
    service = new GitService('C:\\repo');
    proc = fakeProc();
    spawnArgs = [];
    spawnMock.mockImplementation((_bin: string, args: readonly string[]) => {
      spawnArgs = [...args];
      // A real child emits 'spawn' asynchronously, after the caller has
      // attached its listeners; emit on a microtask to mirror that.
      queueMicrotask(() => proc.emit('spawn'));
      return proc as unknown as ReturnType<typeof childProcess.spawn>;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('spawns git difftool detached against the resolved first parent', async () => {
    (service as any).exec = vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args.includes('--verify')) return 'parentsha\n';
      throw new Error(`unexpected git call: ${args.join(' ')}`);
    });

    await service.openExternalDiff('abc123', 'assets/logo.bin');

    expect(spawnArgs).toEqual([
      '-c', 'core.quotePath=false',
      'difftool', '--no-prompt', 'parentsha', 'abc123', '--', 'assets/logo.bin',
    ]);
    const opts = spawnMock.mock.calls[0][2] as { detached?: boolean; cwd?: string; stdio?: string };
    expect(opts.detached).toBe(true);
    expect(opts.cwd).toBe('C:\\repo');
    expect(opts.stdio).toBe('ignore');
    // The GUI tool may outlive the extension host; the child must be unref'd.
    expect(proc.unref).toHaveBeenCalled();
  });

  it('does not wait for the GUI tool to exit (resolves while the process is still running)', async () => {
    (service as any).exec = vi.fn(async () => 'parentsha\n');

    // No 'close' is ever emitted by the mock, yet the call must resolve.
    await expect(service.openExternalDiff('abc123', 'file.bin')).resolves.toBeUndefined();
    expect(proc.unref).toHaveBeenCalledTimes(1);
  });

  it('falls back to the empty tree for a root commit (no parent)', async () => {
    (service as any).exec = vi.fn(async (args: string[]) => {
      if (args[0] === 'rev-parse' && args.includes('--show-object-format')) return 'sha1\n';
      // The parent probe (`--verify --quiet`) exits non-zero for a root commit.
      throw new GitError('', 1, args);
    });

    await service.openExternalDiff('root123', 'file.bin');

    expect(spawnArgs).toContain('4b825dc642cb6eb9a060e54bf8d69288fbee4904');
    expect(spawnArgs).toContain('root123');
  });

  it('rejects when the process cannot be spawned (git missing)', async () => {
    (service as any).exec = vi.fn(async () => 'parentsha\n');
    spawnMock.mockImplementationOnce((_bin: string, args: readonly string[]) => {
      spawnArgs = [...args];
      queueMicrotask(() => proc.emit('error', new Error('spawn git ENOENT')));
      return proc as unknown as ReturnType<typeof childProcess.spawn>;
    });

    await expect(service.openExternalDiff('abc123', 'file.bin')).rejects.toThrow('ENOENT');
    expect(proc.unref).not.toHaveBeenCalled();
  });

  it('rejects unsafe refs and paths before spawning', async () => {
    await expect(service.openExternalDiff('--upload-pack=evil', 'file.bin')).rejects.toThrow();
    await expect(service.openExternalDiff('abc123', '../escape.bin')).rejects.toThrow();
    await expect(service.openExternalDiff('abc123', '-f')).rejects.toThrow();
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
