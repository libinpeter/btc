const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Add stealth plugin for detection avoidance
puppeteer.use(StealthPlugin());

// ScraperAPI key and proxy settings
const proxyAPIKey = process.env.PROXY_API_KEY;
const proxyHost = 'proxy-server.scraperapi.com';
const proxyPort = 8001;

// Function to decode cookies from Base64 and save them to a file
async function loadCookies(page, cookiesPath, base64Cookies) {
    const decodedCookies = Buffer.from(base64Cookies, 'base64').toString('utf8');
    fs.writeFileSync(cookiesPath, decodedCookies);
    console.log(`Decoded cookies saved to ${cookiesPath}`);

    const cookies = JSON.parse(fs.readFileSync(cookiesPath, 'utf8'));
    if (cookies.length) {
        await page.setCookie(...cookies);
        console.log("Loaded existing cookies into the browser.");
        return true;
    } else {
        throw new Error("Cookies file is empty or invalid.");
    }
}

// Function to attempt different connection methods
async function attemptConnection(browserArgs, connectionType) {
    console.log(`Attempting connection via ${connectionType}...`);
    try {
        const browser = await puppeteer.launch({
            headless: true, // Set to false for debugging
            args: browserArgs,
        });
        const page = await browser.newPage();
        if (connectionType === 'Proxy') {
            await page.authenticate({ username: 'scraperapi', password: proxyAPIKey });
        }
        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.110 Safari/537.36'
        );

        // Check and log IP using httpbin.org
        await page.goto('https://httpbin.org/ip', { waitUntil: 'networkidle2' });
        const ipInfo = await page.evaluate(() => JSON.parse(document.body.innerText));
        console.log(`IP Address: ${ipInfo.origin}`);

        await page.goto('https://freebitco.in', { waitUntil: 'networkidle2' });
        console.log("FreeBitcoin page loaded.");
        return { browser, page };
    } catch (error) {
        console.error(`${connectionType} connection failed: ${error.message}`);
        return null;
    }
}

// Function to restart from scratch in case of failure
async function runWithRetry(connectionMethods, cookiesPath, base64Cookies) {
    let connection = null;

    for (const method of connectionMethods) {
        connection = await attemptConnection(method.args, method.name);
        if (connection) {
            const { browser, page } = connection;

            try {
                // Load cookies and reload page
                await loadCookies(page, cookiesPath, base64Cookies);
                await page.reload({ waitUntil: 'networkidle2' });
                console.log("Page reloaded with cookies.");

                // Proceed with further actions (roll, check balance, etc.)
                await performRoll(page);

                await browser.close();
                console.log("Browser closed successfully.");
                return;  // Success, exit retry loop

            } catch (error) {
                console.error(`Error during actions: ${error.message}`);
                await browser.close();  // Close the browser on failure and restart from scratch
            }
        }
    }
    throw new Error('All connection methods failed or actions could not complete.');
}

// Function to perform roll and check balance
async function performRoll(page) {
    try {
        const balanceSelector = '#balance_small';
        const playWithoutCaptchaSelector = 'div#play_without_captchas_button';
        const rollButtonSelector = 'input[id="free_play_form_button"]';
        const resultSelector = '#free_play_result';

        // Check if the user is logged in by checking balance
        let balance = null;
        try {
            await page.waitForSelector(balanceSelector, { visible: true, timeout: 10000 });
            balance = await page.$eval(balanceSelector, el => el.textContent.trim());
            console.log(`Current Balance: ${balance}`);
        } catch (error) {
            console.log("User is not logged in or balance element not found.");
        }

        // Check if the "Play without Captcha" button exists and click if available
        if (await page.$(playWithoutCaptchaSelector)) {
            await page.click(playWithoutCaptchaSelector);
            console.log("Clicked 'Play without Captcha'.");
        }

        // Roll by clicking the roll button
        await page.waitForSelector(rollButtonSelector, { visible: true, timeout: 10000 });
        await page.click(rollButtonSelector);
        console.log("Roll button clicked.");

        // Wait for the result and check the balance again
        await page.waitForSelector(resultSelector, { visible: true, timeout: 10000 });
        const rollResult = await page.$eval(resultSelector, el => el.textContent.trim());
        console.log(`Roll result: ${rollResult}`);

        // Check and log the new balance
        if (balance) {
            const newBalance = await page.$eval(balanceSelector, el => el.textContent.trim());
            console.log(`New Balance: ${newBalance}`);
        }
    } catch (error) {
        throw new Error('Error during game play.');
    }
}

// Main asynchronous function with restart logic for failures
(async () => {
    try {
        // Define the unique cookies path in the /tmp directory
        const timestamp = Date.now();
        const cookiesPath = `user_cookies_${timestamp}.json`;
        const base64Cookies = process.env.USER_COOKIES_BASE64;

        if (!base64Cookies) {
            console.error("Error: Missing necessary environment variables: USER_COOKIES_BASE64.");
            process.exit(1);
        }

        // Set a timeout for 3 minutes (180,000 ms)
        const timeoutId = setTimeout(() => {
            console.error('Timeout: Code exceeded 3 minutes');
            process.exit(1);  // Exit with code 1 after 3 minutes
        }, 180000);  // 3 minutes

        // Define an array of connection methods to try in order
        const connectionMethods = [
            {
                name: 'Tor',
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--proxy-server=socks5://127.0.0.1:9050'],
            },
            // {
            //     name: 'Proxy',
            //     args: [
            //         '--no-sandbox',
            //         `--proxy-server=${proxyHost}:${proxyPort}`,
            //         '--disable-setuid-sandbox',
            //         '--ignore-certificate-errors',
            //     ],
            // },
            {
                name: 'Normal',
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors'],
            },
        ];

        // Run the process with retry logic
        await runWithRetry(connectionMethods, cookiesPath, base64Cookies);
        console.log("runWithRetry completed successfully.");
        // Clear the timeout once the task completes within time
        clearTimeout(timeoutId);
        process.exit(0);  // Success exit code

    } catch (error) {
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
})();
