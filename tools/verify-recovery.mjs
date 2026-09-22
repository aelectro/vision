/**
 * Proves the stale-build recovery reloads once and then stops.
 *
 * The failure mode being guarded against is worse than the bug it fixes: a
 * page that reloads every time a chunk is missing, on a deploy that is
 * genuinely broken, refreshes for ever and shows nothing. So the guard matters
 * more than the reload, and it is what this checks.
 *
 *   npm run dev        (in another terminal)
 *   npm run verify:recovery
 */
import { chromium } from 'playwright'

const URL = process.env.VERIFY_URL ?? 'http://localhost:5173/'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()

let navigations = 0
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) navigations += 1
})

const errors = []
page.on('pageerror', (error) => errors.push(String(error)))

let failed = false

try {
  await page.goto(URL, { waitUntil: 'load' })
  await page.waitForTimeout(500)
  const afterLoad = navigations

  // Exactly what Vite raises when a dynamically imported chunk 404s.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
  })
  await page.waitForTimeout(1500)
  const afterFirst = navigations

  await page.evaluate(() => {
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
  })
  await page.waitForTimeout(1500)
  const afterSecond = navigations

  const guardStillSet = await page.evaluate(() => sessionStorage.getItem('vision.staleReload'))

  console.log('Navigations')
  console.log(`  after first load       ${afterLoad}`)
  console.log(`  after one failure      ${afterFirst}`)
  console.log(`  after a second failure ${afterSecond}`)
  console.log(`  guard flag             ${guardStillSet ?? '(cleared)'}`)

  const checks = [
    ['a missing chunk triggers exactly one reload', afterFirst === afterLoad + 1],
    ['a second failure does not reload again', afterSecond === afterFirst],
    ['the app still rendered', (await page.locator('#root').count()) === 1],
    ['nothing threw', errors.length === 0],
  ]

  console.log('')
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
    if (!ok) failed = true
  }

  for (const error of errors) console.log(`  ${error}`)
} catch (error) {
  failed = true
  console.error('recovery check threw:', error)
} finally {
  await browser.close()
}

process.exit(failed ? 1 : 0)
