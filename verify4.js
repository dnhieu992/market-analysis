const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);

  // Get a session by hitting the API login
  // We'll intercept the form submit instead
  await page.goto('http://localhost:3001/login');
  await page.waitForLoadState('networkidle');
  
  // Fill in login and try with different passwords - check cookies on API
  await page.fill('#email', 'daonguyenhieu090492@gmail.com');
  await page.fill('#password', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1000);
  console.log('After submit URL:', page.url());
  
  await page.screenshot({ path: '/tmp/ss-login-attempt.png' });
  await browser.close();
})();
