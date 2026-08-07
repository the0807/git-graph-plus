import { readFileSync } from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';

interface ExtensionManifest {
  contributes: {
    configuration: {
      properties: Record<string, {
        type?: unknown;
        enum?: unknown;
        default?: unknown;
        scope?: unknown;
      }>;
    };
  };
}

describe('extension manifest defaults', () => {
  it('offers Gravatar and offline Retro avatar sources with Gravatar as the default', () => {
    const manifest = JSON.parse(
      readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as ExtensionManifest;

    expect(
      manifest.contributes.configuration.properties['gitGraphPlus.avatarSource'],
    ).toMatchObject({
      type: 'string',
      enum: ['gravatar', 'retro'],
      default: 'gravatar',
      scope: 'application',
    });
  });
});
