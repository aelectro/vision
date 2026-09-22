/**
 * Runs the in-app diagnostics in a real browser and prints the report.
 *
 * The same code runs on the phone; this checks it works and shows what it will
 * say. Camera permission is granted automatically here, which a phone will not
 * do - that answer is only meaningful on the device.
 *
 *   npm run dev        (in another terminal)
 *   npm run verify:diagnostics
 */
import { chromium } from 'playwright'

const URL = process.env.VERIFY_URL ?? 'http://localhost:5173/'

const browser = await chromium.launch({
  channel: 'msedge',
  // Headless has no camera, so the check would always fail for the wrong
  // reason. A synthetic device exercises the real getUserMedia path.
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const context = await browser.newContext({ permissions: ['camera'] })
const page = await context.newPage()

const errors = []
page.on('pageerror', (error) => errors.push(String(error)))

let failed = false

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })

  const checks = await page.evaluate(async () => {
    const { runDiagnostics, reportText } = await import('/src/features/diagnostics/checks.ts')
    const result = await runDiagnostics()
    return { checks: result, report: reportText(result) }
  })

  for (const check of checks.checks) {
    const note = check.note ? `\n        ${check.note}` : ''
    console.log(
      `  ${check.verdict.toUpperCase().padEnd(5)} ${check.label.padEnd(18)} ${check.value}${note}`,
    )
  }

  console.log('\nReport text:\n')
  console.log(checks.report)

  const expected = ['install', 'camera', 'webgl', 'webgpu', 'video', 'storage', 'platform']
  const keys = checks.checks.map((check) => check.key)

  const assertions = [
    ['every check ran', expected.every((key) => keys.includes(key))],
    ['nothing threw', errors.length === 0],
    ['WebGL2 was found', checks.checks.find((c) => c.key === 'webgl')?.verdict === 'ok'],
    ['H.264 encoding is available', checks.checks.find((c) => c.key === 'video')?.verdict === 'ok'],
    ['the camera path works', checks.checks.find((c) => c.key === 'camera')?.verdict === 'ok'],
    ['the report is copyable text', checks.report.includes('Vision diagnostics')],
  ]

  console.log('')
  for (const [label, ok] of assertions) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
    if (!ok) failed = true
  }

  if (errors.length > 0) {
    console.log('\nPage errors:')
    for (const error of errors) console.log(`  ${error}`)
  }
} catch (error) {
  failed = true
  console.error('diagnostics threw:', error)
} finally {
  await browser.close()
}

process.exit(failed ? 1 : 0)
