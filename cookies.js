const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const winston = require('winston');

// Add stealth plugin for detection avoidance
puppeteer.use(StealthPlugin());

// Configure Winston logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'automation.log' }),
    ],
});

// ScraperAPI key and proxy settings
const proxyAPIKey = process.env.PROXY_API_KEY;
const proxyHost = 'proxy-server.scraperapi.com';
const proxyPort = 8001;

// Define authentication credentials
//const emails = JSON.parse(fs.readFileSync('./emails.json', 'utf8'));
const auth = {
    username: "visualgraces@gmail.com",
    password: process.env.FREEBITCO_PASSWORD,
};

// Function to save cookies as Base64
function saveCookiesAsBase64(cookies, outputPath) {
    const base64Cookies = Buffer.from(JSON.stringify(cookies), 'utf8').toString('base64');
    fs.writeFileSync(outputPath, base64Cookies);
    logger.info(`Cookies saved as Base64 in ${outputPath}`);
}

// Function to attempt different connection methods
async function attemptConnection(browserArgs, connectionType) {
    logger.info(`Attempting connection via ${connectionType}...`);
    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: browserArgs,
            ignoreHTTPSErrors: true,
            defaultViewport: null,
        });
        const page = await browser.newPage();
        if (connectionType === 'Proxy') {
            await page.authenticate({ username: 'scraperapi', password: proxyAPIKey });
        }

        // Check and log IP using httpbin.org
        await page.goto('https://httpbin.org/ip', { waitUntil: 'networkidle2' });
        const ipInfo = await page.evaluate(() => JSON.parse(document.body.innerText));
        console.log(`IP Address: ${ipInfo.origin}`);

        await page.goto('https://freebitco.in', { waitUntil: 'networkidle2' });
        logger.info(`${connectionType} connection successful!`);
        return { browser, page };
    } catch (error) {
        logger.error(`${connectionType} connection failed: ${error.message}`);
        return null;
    }
}

// Function to restart from scratch in case of failure
async function runWithRetry(connectionMethods, cookiesPath, cookiesBase64Path) {
    let connection = null;

    for (const method of connectionMethods) {
        connection = await attemptConnection(method.args, method.name);
        if (connection) {
            const { browser, page } = connection;

            try {
                const savedCookies = fs.existsSync(cookiesPath) ? JSON.parse(fs.readFileSync(cookiesPath, 'utf8')) : null;
                if (savedCookies) {
                    await page.setCookie(...savedCookies);
                    logger.info("Cookies loaded. Reloading page...");
                    await page.reload({ waitUntil: 'networkidle2' });
                } else {
                    logger.info("No cookies found. Starting a new session.");
                    // Attempt login or other actions, and restart on failure
                    await performLogin(page);
                }

                // Save cookies after login.
                const newCookies = await page.cookies();
                fs.writeFileSync(cookiesPath, JSON.stringify(newCookies, null, 2));
                saveCookiesAsBase64(newCookies, cookiesBase64Path);

                await browser.close();
                logger.info("Browser closed successfully.");
                return;  // Success, exit retry loop

            } catch (error) {
                logger.error(`Error during actions: ${error.message}`);
                await browser.close();  // Close the browser on failure and restart from scratch
            }
        }
    }
    logger.error('All connection methods failed or actions could not complete.');
}

// Function to perform login and handle retries
async function performLogin(page) {
    try {
        // Check if the user is already logged in by checking balance
        const balanceSelector = '#balance_small';
        await page.waitForSelector(balanceSelector, { visible: true, timeout: 20000 });
        const balance = await page.$eval(balanceSelector, el => el.textContent.trim());
        logger.info(`Logged in. Current Balance: ${balance}`);
    } catch (e) {
        logger.info("User not logged in. Proceeding with login.");

        // Attempt to close the "NO THANKS" pop-up if it appears
        try {
            await page.waitForSelector('.pushpad_deny_button', { visible: true, timeout: 5000 });
            await page.click('.pushpad_deny_button');
            logger.info("Closed the pop-up.");
        } catch (error) {
            logger.info("Pop-up not found, continuing with the script.");
        }

        try {
            await page.click('li.login_menu_button > a');
            await page.waitForSelector('#login_form', { visible: true, timeout: 10000 });
            await page.type('#login_form_btc_address', auth.username, { delay: 100 });
            await page.type('#login_form_password', auth.password, { delay: 100 });
            await Promise.all([page.click('#login_button'), page.waitForNavigation({ waitUntil: 'networkidle2' })]);
            logger.info("Login successful.");
        } catch (error) {
            throw new Error('Login failed.');
        }
    }
}

// Main asynchronous function with restart logic for failures
(async () => {
    try {
        // Directories for JSON and base64
        const jsonDir = path.resolve(__dirname, 'cookies', 'json');
        const base64Dir = path.resolve(__dirname, 'cookies', 'base64');

        // Create the directories if they don't exist
        if (!fs.existsSync(jsonDir)) {
            fs.mkdirSync(jsonDir, { recursive: true });
        }
        if (!fs.existsSync(base64Dir)) {
            fs.mkdirSync(base64Dir, { recursive: true });
        }

        // Extract email prefix
        const email = auth.username.split('@')[0];  // Only get the part before '@'

        // Paths for the JSON and base64 files
        const cookiesPath = path.resolve(jsonDir, `${email}_cookies.json`);
        const cookiesBase64Path = path.resolve(base64Dir, `${email}_cookies_base64.txt`);

        // Define an array of connection methods to try in order
        const connectionMethods = [
            {
                name: 'Tor',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--proxy-server=socks5://127.0.0.1:9050'
                ],
            },
            // {
            //     name: 'Proxy',
            //     args: [
            //         '--no-sandbox',
            //         `--proxy-server=${proxyHost}:${proxyPort}`,
            //         '--disable-setuid-sandbox',
            //         '--ignore-certificate-errors'
            //     ],
            // },
            {
                name: 'Normal',
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--ignore-certificate-errors'
                ],
            },
        ];

        // Run the process with retry logic
        await runWithRetry(connectionMethods, cookiesPath, cookiesBase64Path);
        console.log("runWithRetry completed successfully.");
        process.exit(0);  // Success exit code

    } catch (error) {
        logger.error(`Error: ${error.message}`);
        process.exit(1);
    }
})();
