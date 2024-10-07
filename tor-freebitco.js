const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());
const fs = require('fs');
const path = require('path');


// Function to decode cookies from Base64 and save them to a file
async function loadCookies(page, cookiesPath, base64Cookies) {
    if (!fs.existsSync(cookiesPath)) {
        const decodedCookies = Buffer.from(base64Cookies, 'base64').toString('utf8');
        fs.writeFileSync(cookiesPath, decodedCookies);
        console.log(`Decoded cookies saved to ${cookiesPath}`);
    }

    const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
    if (cookies.length) {
        await page.setCookie(...cookies);
        console.log("Loaded existing cookies into the browser.");
        return true;
    } else {
        throw new Error("Cookies file is empty or invalid.");
    }
}

(async () => {
    try {
        const browser = await puppeteer.launch({
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--start-maximized'  // Launch browser in full display
            ],
            defaultViewport: null
        });

        console.log("Navigating to FreeBitcoin...");
        const page = await browser.newPage();
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.110 Safari/537.36'
        );
        await page.goto('https://freebitco.in', { waitUntil: 'networkidle2' });
        console.log("FreeBitcoin page loaded.");

        const timestamp = Date.now();
        const cookiesPath = `/tmp/user_cookies_${timestamp}.json`;
        let base64Cookies = process.env.USER_COOKIES_BASE64;
        if (!base64Cookies) {
            const base64Dir = path.resolve(__dirname, 'cookies', 'base64');
            const email = process.env.FREEBITCO_USER.split('@')[0];  // Only get the part before '@'
            base64Cookies = fs.readFileSync(path.resolve(base64Dir, `${email}_cookies_base64.txt`), 'utf8');
        }

        // Load cookies and apply them
        try {
            await loadCookies(page, cookiesPath, base64Cookies);
            await page.reload({ waitUntil: 'networkidle2' });
            console.log("Page reloaded with cookies.");
        } catch (error) {
            console.error("Error loading cookies:", error);
            process.exit(1);
        }

    } catch (error) {
        console.error("Error:", error);
    }
})();
