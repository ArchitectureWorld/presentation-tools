#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const inputHtml = path.join(root, 'prototype/index.html')
const outputHtml = path.join(root, 'report-studio-prototype.html')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function safeInlineScript(source) {
  return source
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '<\\!--')
}

let html = fs.readFileSync(inputHtml, 'utf8')
const css = read('prototype/styles.css')
const core = safeInlineScript(read('src/studio-model.js'))
const adapter = safeInlineScript(read('src/mock-studio-adapter.js'))
const app = safeInlineScript(read('prototype/app.js'))

html = html
  .replace(
    /\s*<link\s+rel="stylesheet"\s+href="\.\/styles\.css"\s*>/,
    `\n  <style data-report-studio-inline>\n${css}\n  </style>`,
  )
  .replace(
    /\s*<script\s+src="\.\.\/src\/studio-model\.js"><\/script>/,
    `\n  <script data-report-studio-core>\n${core}\n  </script>`,
  )
  .replace(
    /\s*<script\s+src="\.\.\/src\/mock-studio-adapter\.js"><\/script>/,
    `\n  <script data-report-studio-adapter>\n${adapter}\n  </script>`,
  )
  .replace(
    /\s*<script\s+src="\.\/app\.js"><\/script>/,
    `\n  <script data-report-studio-app>\n${app}\n  </script>`,
  )
  .replace(
    '<title>汇报制作系统｜交互原型</title>',
    '<title>汇报制作系统｜可运行交互原型</title>\n  <meta name="report-studio-build" content="single-file-v0.8.1">',
  )

const remainingExternal = [
  /<link[^>]+stylesheet/i,
  /<script[^>]+src=/i,
  /https?:\/\//i,
]
for (const pattern of remainingExternal) {
  if (pattern.test(html)) throw new Error(`生成文件仍包含外部依赖：${pattern}`)
}

fs.writeFileSync(outputHtml, html)
console.log(`Built ${path.relative(root, outputHtml)} (${Buffer.byteLength(html)} bytes)`)
