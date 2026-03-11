/**
 * Pixel Agents CLI — Standalone pixel art office in the browser
 *
 * Serves the webview and auto-detects running Claude Code sessions.
 * Usage: pixel-agents [--port <number>]
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { CliOrchestrator } from './cliOrchestrator.js';
import { createServer } from './server.js';

const DEFAULT_PORT = 7842;

function parseArgs(): { port: number } {
  const args = process.argv.slice(2);
  let port = DEFAULT_PORT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`Invalid port: ${args[i + 1]}`);
        process.exit(1);
      }
      i++;
    }
  }
  return { port };
}

function resolveDistDir(): string {
  // In bundled mode: dist/cli.js → dist/ is the parent
  // Use import.meta.url for ESM compatibility
  const thisFile = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
  const distDir = path.dirname(thisFile);
  const webviewDir = path.join(distDir, 'webview');

  if (!fs.existsSync(webviewDir)) {
    console.error(`Webview directory not found: ${webviewDir}`);
    console.error('Run "npm run build:webview" first.');
    process.exit(1);
  }

  const assetsDir = path.join(distDir, 'assets');
  if (!fs.existsSync(assetsDir)) {
    console.warn(`Assets directory not found: ${assetsDir}`);
    console.warn('Run "npm run build" to copy assets.');
  }

  return distDir;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;
  if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, (err) => {
    if (err) {
      console.log(`Open ${url} in your browser`);
    }
  });
}

function main(): void {
  const { port } = parseArgs();
  const distDir = resolveDistDir();
  const webviewDir = path.join(distDir, 'webview');

  const orchestrator = new CliOrchestrator({ distDir });
  const server = createServer(webviewDir, orchestrator);

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n🎮 Pixel Agents running at ${url}`);
    console.log('   Watching for Claude Code sessions...');
    console.log('   Press Ctrl+C to stop.\n');
    openBrowser(url);
  });

  const shutdown = () => {
    console.log('\nShutting down...');
    orchestrator.dispose();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
