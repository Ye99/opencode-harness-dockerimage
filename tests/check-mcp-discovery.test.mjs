import assert from 'node:assert/strict';
import test from 'node:test';

import { assertMcpDiscovery, getMcpDiscoveryState } from '../scripts/check-mcp-discovery.mjs';

const formattedOutput = `┌  MCP Servers
│
●  ✓ context7 connected
│      https://mcp.context7.com/mcp
│
●  ✓ grep_app connected
│      https://mcp.grep.app
│
●  ○ brave-search disabled
│      mcp-server-brave-search
│
└  3 server(s)
`;

const ansiFormattedOutput = `\u001b[0m
┌  MCP Servers
│
●  ✓ context7 \u001b[90mconnected
│      \u001b[90mhttps://mcp.context7.com/mcp
│
●  ✓ grep_app \u001b[90mconnected
│      \u001b[90mhttps://mcp.grep.app
│
●  ○ brave-search \u001b[90mdisabled
│      \u001b[90mmcp-server-brave-search
│
└  3 server(s)
`;

test('getMcpDiscoveryState parses exact discovered entries from formatted output', () => {
  assert.equal(getMcpDiscoveryState(formattedOutput, 'context7'), 'enabled');
  assert.equal(getMcpDiscoveryState(formattedOutput, 'grep_app'), 'enabled');
  assert.equal(getMcpDiscoveryState(formattedOutput, 'brave-search'), 'disabled');
});

test('getMcpDiscoveryState strips ANSI before parsing real formatted rows', () => {
  assert.equal(getMcpDiscoveryState(ansiFormattedOutput, 'context7'), 'enabled');
  assert.equal(getMcpDiscoveryState(ansiFormattedOutput, 'brave-search'), 'disabled');
});

test('getMcpDiscoveryState treats non-disabled status text as informational', () => {
  const output = `┌  MCP Servers
│
●  ✓ context7 initializing
│      https://mcp.context7.com/mcp
│
●  ✓ grep_app retrying
│      https://mcp.grep.app
│
●  ○ brave-search disabled by config
│      mcp-server-brave-search
│
└  3 server(s)
`;

  assert.equal(getMcpDiscoveryState(output, 'context7'), 'enabled');
  assert.equal(getMcpDiscoveryState(output, 'grep_app'), 'enabled');
  assert.equal(getMcpDiscoveryState(output, 'brave-search'), 'disabled');
});

test('getMcpDiscoveryState treats failed rows as discovered unless explicitly disabled', () => {
  const output = `┌  MCP Servers
│
●  ✗ context7 failed
│      https://mcp.context7.com/mcp
│
●  ✗ grep_app failed
│      https://mcp.grep.app
│
●  ○ brave-search disabled
│      mcp-server-brave-search
│
└  3 server(s)
`;

  assert.equal(getMcpDiscoveryState(output, 'context7'), 'enabled');
  assert.equal(getMcpDiscoveryState(output, 'grep_app'), 'enabled');
  assert.equal(getMcpDiscoveryState(output, 'brave-search'), 'disabled');
});

test('getMcpDiscoveryState keeps exact matching and ignores near-matches', () => {
  const output = 'context70 connected\ngrep_application connected\nxbrave-searchx disabled\n';

  assert.equal(getMcpDiscoveryState(output, 'context7'), 'missing');
  assert.equal(getMcpDiscoveryState(output, 'grep_app'), 'missing');
  assert.equal(getMcpDiscoveryState(output, 'brave-search'), 'missing');
});

test('getMcpDiscoveryState rejects comma-prefixed lines (comma is not a valid bullet)', () => {
  const output = ', fake-server connected\n';
  assert.equal(getMcpDiscoveryState(output, 'fake-server'), 'missing');
});

test('assertMcpDiscovery distinguishes disabled-or-omitted Brave from enabled Brave', () => {
  assert.doesNotThrow(() => {
    assertMcpDiscovery(formattedOutput, {
      requireEnabled: ['context7', 'grep_app'],
      requireMissingOrDisabled: ['brave-search'],
    });
  });

  assert.throws(
    () => {
      assertMcpDiscovery('context7 connected\ngrep_app connected\nbrave-search connected\n', {
        requireEnabled: ['context7', 'grep_app'],
        requireMissingOrDisabled: ['brave-search'],
      });
    },
    /Discovered MCP server must be disabled or omitted: brave-search/,
  );
});
