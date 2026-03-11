/**
 * Pixel Agents CLI — Standalone pixel art office in the browser
 *
 * Serves the webview and auto-detects running agent sessions.
 * Usage: pixel-agents [--port <number>] [--source claude|openclaw]
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { CliOrchestrator } from './cliOrchestrator.js';
import { createServer } from './server.js';

const DEFAULT_PORT = 7842;

export type SourceType = 'claude' | 'openclaw';

function parseArgs(): { port: number; source: SourceType } {
  const args = process.argv.slice(2);
  let port = DEFAULT_PORT;
  let source: SourceType = 'claude';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error(`Invalid port: ${args[i + 1]}`);
        process.exit(1);
      }
      i++;
    } else if (args[i] === '--source' && args[i + 1]) {
      const val = args[i + 1].toLowerCase();
      if (val === 'openclaw' || val === 'claude') {
        source = val;
      } else {
        console.error(`Invalid source: ${args[i + 1]} (expected: claude or openclaw)`);
        process.exit(1);
      }
      i++;
    }
  }
  return { port, source };
}

function resolveDistDir(): string {
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
  const { port, source } = parseArgs();
  const distDir = resolveDistDir();
  const webviewDir = path.join(distDir, 'webview');

  const orchestrator = new CliOrchestrator({ distDir, source });
  const server = createServer(webviewDir, orchestrator);

  const sourceLabel = source === 'openclaw' ? 'OpenClaw agents' : 'Claude Code sessions';

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`\n🎮 Pixel Agents running at ${url}`);
    console.log(`   Source: ${sourceLabel}`);
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
