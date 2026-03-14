import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  target: 'node18',
});

if (isWatch) {
  console.log('Watching for changes...');
  await ctx.watch();
} else {
  await ctx.rebuild();
  ctx.dispose();
}
