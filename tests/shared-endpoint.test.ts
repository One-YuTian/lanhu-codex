import { expect, it } from 'vitest';
import { bridgeAddress } from '../src/shared-service';
import { BRIDGE_RUNTIME } from '../src/runtime-version';

it('Unix socket 地址不受插件目录或 macOS TMPDIR 长度影响，保留完整版本后缀', () => {
  const data = `/Users/用户/.codex/plugins/data/agent-plugins/${'a'.repeat(64)}`;
  const address = bridgeAddress(data, 'darwin', 501);
  expect(Buffer.byteLength(address)).toBeLessThan(104);
  expect(address).toMatch(/^\/tmp\/lanhu-501-[a-f0-9]{24}\//);
  expect(address.endsWith(`/${BRIDGE_RUNTIME}.sock`)).toBe(true);
  expect(bridgeAddress(`${data}/other`, 'darwin', 501)).not.toBe(address);
  expect(bridgeAddress(data, 'darwin', 502)).not.toBe(address);
  expect(bridgeAddress(data, 'linux', 501)).toBe(address);
});

it('Windows 继续使用原有版本化命名管道', () => {
  expect(bridgeAddress('/fixture', 'win32')).toMatch(new RegExp(`^\\\\\\\\\\.\\\\pipe\\\\lanhu-${BRIDGE_RUNTIME}-[a-f0-9]{24}$`));
});
