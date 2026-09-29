import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { isTrustedPage } from '../electron/main/security'

const entry = resolve('测试目录/renderer/index.html')

test('生产环境只允许指定入口文件以及其 hash 路由', () => {
  const url = pathToFileURL(entry).href
  assert.equal(isTrustedPage(url, entry), true)
  assert.equal(isTrustedPage(url + '#/settings', entry), true)
  for (const candidate of [
    pathToFileURL(resolve('测试目录/renderer/other.html')).href,
    pathToFileURL(resolve('测试目录/renderer-other/index.html')).href,
    'https://example.invalid/index.html',
    'http://127.0.0.1:5173/',
    'about:blank',
    'data:text/html,',
    'javascript:void(0)',
    'invalid'
  ]) {
    assert.equal(isTrustedPage(candidate, entry), false, candidate)
  }
})

test('开发环境只接受本机开发服务器的同源入口', () => {
  const dev = 'http://127.0.0.1:5173/'
  assert.equal(isTrustedPage(dev + '#/workspace', entry, dev), true)
  assert.equal(
    isTrustedPage('http://localhost:5173/#/settings', entry, 'http://localhost:5173/'),
    true
  )
  for (const candidate of [
    'http://127.0.0.1:5174/',
    'https://127.0.0.1:5173/',
    'http://127.0.0.1.example.invalid:5173/',
    'http://127.0.0.1:5173/other.html',
    'http://user:password@127.0.0.1:5173/',
    pathToFileURL(entry).href
  ]) {
    assert.equal(isTrustedPage(candidate, entry, dev), false, candidate)
  }
  assert.equal(isTrustedPage('https://example.invalid/', entry, 'https://example.invalid/'), false)
})
