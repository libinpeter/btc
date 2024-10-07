const CDP = require('chrome-remote-interface');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');


// Utility function to pause execution for a given time (milliseconds)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Loads cookies into the browser session via CDP.
 * @param {object} client - The CDP client instance.
 * @param {string} cookiesPath - Path to the cookies JSON file.
 * @param {string} base64Cookies - Base64-encoded cookies string from environment variable.
 */
async function loadCookies(client, cookiesPath, base64Cookies) {
    const { Network } = client;
    if (base64Cookies) {
        try {
            const decodedCookies = Buffer.from(base64Cookies, 'base64').toString('utf8');
            fs.writeFileSync(cookiesPath, decodedCookies);
            console.log(`Decoded cookies saved to ${cookiesPath}`);
        } catch (err) {
            throw new Error(`Failed to decode and save cookies: ${err.message}`);
        }
    }

    // Read and parse cookies
    let cookies;
    try {
        const cookiesData = fs.readFileSync(cookiesPath, 'utf8');
        cookies = JSON.parse(cookiesData);
    } catch (err) {
        throw new Error(`Failed to read or parse cookies file: ${err.message}`);
    }

    // Validate cookies
    if (!Array.isArray(cookies) || cookies.length === 0 || !cookies.every(cookie => cookie.domain.includes('freebitco.in'))) {
        throw new Error("Cookies file is empty, invalid, or not for the correct domain.");
    }

    // Set cookies via CDP
    try {
        await Network.setCookies({ cookies });
        console.log("Loaded existing cookies into the browser for freebitco.in.");
    } catch (err) {
        throw new Error(`Failed to set cookies via CDP: ${err.message}`);
    }
}

/**
 * Retrieves the user's current balance from the page via CDP.
 * @param {object} client - The CDP client instance.
 * @returns {string|null} - The current balance or null if not found.
 */
async function getBalance(client) {
    const { Runtime } = client;
    try {
        const { result } = await Runtime.evaluate({
            expression: `document.querySelector('#balance_small').textContent.trim()`,
            returnByValue: true,
        });
        return result.value;
    } catch (err) {
        console.log("Balance element not found or user is not logged in.");
        return null;
    }
}

/**
 * Solves the CAPTCHA using the CloudFreed instance.
 * @param {object} instance - The CloudFreed instance.
 * @returns {boolean} - True if CAPTCHA is solved successfully, else false.
 */
async function solveCaptchaWithCloudFreed(instance) {
    try {
        console.log("Solving CAPTCHA...");
        const captchaResult = await instance.Solve({
            type: "Turnstile",
            url: "https://freebitco.in",
            sitekey: "0x4AAAAAAALkypjU_nEMXCxv"  // Ensure the correct sitekey
        });
        return captchaResult;
    } catch (error) {
        console.error("Error solving CAPTCHA:", error.message);
        return false;
    }
}

/**
 * Clicks the roll button (or any specified button) using Puppeteer Core.
 * @param {object} instance - The CloudFreed instance containing WebSocket URL.
 * @param {string} selector - The CSS selector of the button to click.
 * @returns {boolean} - True if the click action was successful, else false.
 */
// async function clickRoll(instance, selector) {
//     try {
//         const webSocketDebuggerUrl = instance.webSocketDebuggerUrl;

//         // Connect Puppeteer to the existing browser instance
//         const browser = await puppeteer.connect({
//             browserWSEndpoint: webSocketDebuggerUrl,
//             defaultViewport: null, // Use default viewport
//         });

//         const pages = await browser.pages();
//         const page = pages[0] || await browser.newPage();  // Ensure at least one page

//         // Verify CAPTCHA Response Token
//         await sleep(10000);
//         const captchaTokenSelector = 'input[name="cf-turnstile-response"]'; // Adjust the selector based on actual implementation
//         const captchaToken = await page.$eval(captchaTokenSelector, el => el.value.trim()).catch(() => null);

//         if (captchaToken) {
//             console.log("CAPTCHA response token is present from puppeeter:", captchaToken);
//         } else {
//             console.error("CAPTCHA response token is missing.");
//             throw new Error("CAPTCHA response token not found.");
//         }

//         // Wait for the specified selector and click it
//         await page.waitForSelector(selector, { visible: true, timeout: 10000 });
//         await page.click(selector);
//         console.log(`Clicked button with selector "${selector}".`);

//         // Example: Wait for a result message
//         const resultSelector = '#free_play_result';
//         await page.waitForSelector(resultSelector, { visible: true, timeout: 10000 });
//         const rollResult = await page.$eval(resultSelector, el => el.textContent.trim());
//         console.log(`Roll result: ${rollResult}`);

//         // Retrieve the updated balance
//         const balanceSelector = '#balance_small';
//         const newBalance = await page.$eval(balanceSelector, el => el.textContent.trim());
//         console.log(`New Balance: ${newBalance}`);

//         await browser.disconnect(); // Disconnect Puppeteer without closing the browser
//         return true;
//     } catch (error) {
//         console.error(`Error during Puppeteer operation: ${error.message}`);
//         throw error; // Propagate the error to trigger a full restart
//     }
// }

async function clickRoll(selector, Runtime) {
    const captchaTokenSelector = 'input[name="cf-turnstile-response"]';

    async function clickButton() {
        const script = `
            (function() {
                const button = document.querySelector('${selector}');
                if (button) {
                    button.click();
                    return true;
                }
                return false;
            })();
        `;
        const clickResult = await evaluateScript(script, Runtime);
        if (clickResult) {
            console.log(`Clicked button with selector "${selector}".`);
            return true;
        } else {
            console.log(`Button with selector "${selector}" not found.`);
            return false;
        }
    }

    try {
        await sleep(7000);
        const isCaptchaPresent = await checkCaptchaToken(captchaTokenSelector, Runtime);
        if (!isCaptchaPresent) {
            throw new Error("CAPTCHA response token not found.");
        }

        const clicked = await clickButton();
        if (!clicked) {
            throw new Error(`Failed to click button with selector "${selector}".`);
        }

        await new Promise(resolve => setTimeout(resolve, 5000));

        const resultSelector = '#free_play_result';
        const rollResultScript = `
            (function() {
                const el = document.querySelector('${resultSelector}');
                return el ? el.textContent.trim() : null;
            })();
        `;
        const rollResult = await evaluateScript(rollResultScript, Runtime);
        if (rollResult) {
            console.log(`Roll result: ${rollResult}`);
        } else {
            console.log("Roll result not found.");
        }

        const balanceSelector = '#balance_small';
        const balanceScript = `
            (function() {
                const el = document.querySelector('${balanceSelector}');
                return el ? el.textContent.trim() : null;
            })();
        `;
        const newBalance = await evaluateScript(balanceScript, Runtime);
        if (newBalance) {
            console.log(`New Balance: ${newBalance}`);
        } else {
            console.log("New balance not found.");
        }

        return true;
    } catch (error) {
        console.error(`Error during CDP operation: ${error.message}`);
        return false;
    }
}

async function evaluateScript(script, Runtime) {
    const result = await Runtime.evaluate({
        expression: script,
        returnByValue: true,
        awaitPromise: true,
    });
    if (result.exceptionDetails) {
        console.error('Runtime.evaluate exception:', result.exceptionDetails);
        return null;
    }
    return result.result.value;
}

async function injectCaptchaToken(captchaTokenSelector, token, Runtime) {
    const injectScript = `
        (function() {
            const el = document.querySelector('${captchaTokenSelector}');
            if (el) {
                el.value = '${token}';
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            return false;
        })();
    `;
    const injectResult = await evaluateScript(injectScript, Runtime);
    if (injectResult) {
        console.log("CAPTCHA response token injected successfully.");
        return true;
    } else {
        console.log("Failed to inject CAPTCHA response token.");
        return false;
    }
}

async function checkCaptchaToken(captchaTokenSelector, Runtime) {
    const script = `
        (function() {
            const el = document.querySelector('${captchaTokenSelector}');
            return el ? el.value.trim() : null;
        })();
    `;
    const captchaToken = await evaluateScript(script, Runtime);
    if (captchaToken) {
        console.log("CAPTCHA response token is present:", captchaToken);
        return true;
    } else {
        console.log("CAPTCHA response token is missing.");
        return false;
    }
}

/**
 * Performs the entire automation process with a specified number of attempts.
 * @param {number} maxAttempts - Maximum number of automation attempts.
 */
async function performAutomation(maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let client = null;
        let instance = null;

        try {
            console.log(`\n--- Automation Attempt ${attempt} of ${maxAttempts} ---`);

            // 1. Start CloudFreed
            const CloudFreed = (await import('../CloudFreed-CloudFlare-solver-bypass/index.js')).default;
            const CF = new CloudFreed();
            instance = await CF.start(true, true);
            console.log("CloudFreed instance started.");

            // 2. List CDP targets and find the CloudFreed page
            const targets = await CDP.List({ port: instance.port });
            const cloudFreedTarget = targets.find(target =>
                target.title.includes("CloudFreed") || target.url.includes("CloudFreed.html")
            );

            if (!cloudFreedTarget) {
                throw new Error("Could not find the CloudFreed page target.");
            }

            console.log(`Connecting to CloudFreed page via WebSocket: ${cloudFreedTarget.webSocketDebuggerUrl}`);

            // 3. Connect to the CloudFreed page via CDP
            client = await CDP({ target: cloudFreedTarget.webSocketDebuggerUrl });
            const { Network, Page, DOM, Runtime, Emulation } = client;

            // 4. Enable necessary CDP domains
            await Network.enable();
            await Page.enable();
            await DOM.enable();
            await Runtime.enable();

            // 5. Load cookies
            const cookiesPath = path.resolve('user_cookies.json');
            const base64Cookies = process.env.USER_COOKIES_BASE64 || '';
            await loadCookies(client, cookiesPath, base64Cookies);

            // 6. Navigate to freebitco.in
            console.log('Navigating to https://freebitco.in...');
            await Page.navigate({ url: 'https://freebitco.in' });
            await Page.loadEventFired(); // Wait for the page to load
            console.log('Navigation to freebitco.in completed.');
            await sleep(5000); // Wait 5 seconds before retrying

            // Get the page's layout metrics (content size)
            console.log('Getting page details...');
            try {
                const { contentSize } = await Page.getLayoutMetrics();
                const { width, height } = contentSize || { width: 1920, height: 1080 };
                await Emulation.setDeviceMetricsOverride({
                    width: Math.ceil(width),
                    height: Math.ceil(height),
                    deviceScaleFactor: 1,
                    mobile: false,
                });
            } catch (err) {
                console.error('Error setting device metrics:', err);
            }
            
            console.log('Taking screenshot...');
            const screenshot = await Page.captureScreenshot({ format: 'png', fromSurface: true });
            const buffer = Buffer.from(screenshot.data, 'base64');
            fs.writeFileSync('fullpage_screenshot1.png', buffer);
            console.log('Screenshot taken');

            // 7. Retrieve initial balance
            const initialBalance = await getBalance(client);
            console.log(`Initial Balance: ${initialBalance}`);

            const { result: timeIndicator } = await Runtime.evaluate({
                expression: "$('#time_remaining').text()",
                returnByValue: true // Return the actual value
            });
            const timeIndicatorFreePlay = parseInt(timeIndicator.value, 10);
            if (timeIndicatorFreePlay > 0) {
                console.log(`Need to wait for ${timeIndicatorFreePlay} mins before the next roll`);
                break;
            }

            // 8. Solve CAPTCHA
            const captchaResult = await solveCaptchaWithCloudFreed(instance);
            console.log("CAPTCHA result:", captchaResult);
            if (!captchaResult) {
                throw new Error("CAPTCHA solving failed.");
            }

            // 4. Enable necessary CDP domains
            await Network.enable();
            await Page.enable();
            await DOM.enable();
            await Runtime.enable();

            // 9. Navigate back to freebitco.in after CAPTCHA
            await loadCookies(client, cookiesPath, base64Cookies);
            console.log('Cookies reloaded.');
            console.log('Navigating back to https://freebitco.in after CAPTCHA solving...');
            await Page.navigate({ url: 'https://freebitco.in' });
            await Page.loadEventFired(); // Wait for the page to load
            console.log('Navigation completed.');

            // inject token
            const captchaTokenSelector = 'input[name="cf-turnstile-response"]';
            if (captchaResult.success && captchaResult.response) {
                console.log("CAPTCHA solved successfully.");
                const injected = await injectCaptchaToken(captchaTokenSelector, captchaResult.response, Runtime);
                if (!injected) {
                    console.log("Failed to inject CAPTCHA token...");
                }
            }

            await sleep(5000); // Wait 5 seconds before retrying
            console.log('Taking screenshot...');
            const screenshot1 = await Page.captureScreenshot({ format: 'png', fromSurface: true });
            const buffer1 = Buffer.from(screenshot1.data, 'base64');
            fs.writeFileSync('fullpage_screenshot2.png', buffer1);
            console.log('Screenshot taken');
  
            // 10. Click the roll button
            const rollSuccess = await clickRoll('input#free_play_form_button', Runtime);

            console.log('Taking screenshot...');
            const screenshot2 = await Page.captureScreenshot({ format: 'png', fromSurface: true });
            const buffer2 = Buffer.from(screenshot2.data, 'base64');
            fs.writeFileSync('fullpage_screenshot3.png', buffer2);
            console.log('Screenshot taken');
    
            if (rollSuccess) {
                console.log("Roll action succeeded.");
                console.log(`--- Automation Attempt ${attempt} Completed Successfully ---\n`);
                break; // Exit the loop on success
            } else {
                throw new Error("Roll action failed.");
            }

        } catch (error) {
            console.error(`Automation Attempt ${attempt} Failed: ${error.message}`);

            // If not the last attempt, wait before retrying
            if (attempt < maxAttempts) {
                console.log("Restarting the automation process...\n");
                await sleep(10000); // Wait
            } else {
                console.log("Maximum automation attempts reached. Exiting.");
            }
        } finally {
            // Cleanup resources
            if (client) {
                try {
                    await client.close();
                    console.log("CDP client closed.");
                } catch (closeError) {
                    console.error(`Error closing CDP client: ${closeError.message}`);
                }
            }
        
            if (instance) {
                try {
                    await instance.Close();
                    console.log("CloudFreed instance closed.");
                } catch (closeError) {
                    console.error(`Error closing CloudFreed instance: ${closeError.message}`);
                }
            }  
        }
    }
}

const timeout = 15 * 60 * 1000; // 15 minutes in milliseconds

// Function to perform automation with a timeout
const performAutomationWithTimeout = async (maxAttempts) => {
    // Set the timeout that will exit the process after 15 minutes
    const timeoutId = setTimeout(() => {
        console.error('Timeout: Process exceeded 15 minutes');
        process.exit(1);  // Exit with code 1 after 15 minutes
    }, timeout);

    try {
        // Run the automation process
        await performAutomation(maxAttempts);
    } finally {
        // Clear the timeout if the automation finishes within time
        clearTimeout(timeoutId);
    }
};

// Execute the automation process with a kill switch
(async () => {
    try {
        await performAutomationWithTimeout(5); // Set maxAttempts
        process.exit(0);
    } catch (error) {
        console.error(error.message); // Handle the error
        process.exit(1);  // Exit with failure
    }
})();
