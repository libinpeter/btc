const CDP = require('chrome-remote-interface');
const fs = require('fs');

// Utility function to pause execution for a given time (milliseconds)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

async function performAutomation() {
    let client = null;
    let instance = null;

    try {
        // Start CloudFreed
        const CloudFreed = (await import('../CloudFreed-CloudFlare-solver-bypass/index.js')).default;
        const CF = new CloudFreed();
        instance = await CF.start(true, true);
        console.log("CloudFreed instance started.");

        // List CDP targets and find the CloudFreed page
        const targets = await CDP.List({ port: instance.port });
        const cloudFreedTarget = targets.find(target =>
            target.title.includes("CloudFreed") || target.url.includes("CloudFreed.html")
        );

        if (!cloudFreedTarget) {
            throw new Error("Could not find the CloudFreed page target.");
        }

        console.log(`Connecting to CloudFreed page via WebSocket: ${cloudFreedTarget.webSocketDebuggerUrl}`);

        // Connect to the CloudFreed page via CDP
        client = await CDP({ target: cloudFreedTarget.webSocketDebuggerUrl });
        const { Network, Page, DOM, Runtime, Emulation } = client;

        // Enable necessary CDP domains
        await Network.enable();
        await Page.enable();
        await DOM.enable();
        await Runtime.enable();

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

        // Solve CAPTCHA
        const captchaResult = await solveCaptchaWithCloudFreed(instance);
        console.log("CAPTCHA result:", captchaResult);
        if (!captchaResult) {
            throw new Error("CAPTCHA solving failed.");
        }

        // Enable necessary CDP domains
        await Network.enable();
        await Page.enable();
        await DOM.enable();
        await Runtime.enable();

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

        const isCaptchaPresent = await checkCaptchaToken(captchaTokenSelector, Runtime);
        if (!isCaptchaPresent) {
            console.log("CAPTCHA response token not found.");
        }

        await sleep(5000); // Wait 5 seconds

        // Select the email input field and set the value from a JSON file
        const emails = JSON.parse(fs.readFileSync('./emails.json', 'utf8'));
        const email = emails[process.env.FREEBITCO_USER_NO];
        console.log("email:", `${email}`)
        await Runtime.evaluate({
            expression: `document.querySelector("input#signup_form_email").value = "${email}";`
        });

        // Select the password input field and set the value
        const password = process.env.FREEBITCO_PASSWORD;
        console.log("pass:", `${password}`)
        await Runtime.evaluate({
            expression: `document.querySelector("input#signup_form_password").value = "${password}";`
        });

        // Select the password input field and set the value
        const referrer = "10175864";
        await Runtime.evaluate({
            expression: `document.querySelector("input#referrer_in_form").value = "${referrer}";`
        });

        await sleep(5000);

        const isCaptchaPresent1 = await checkCaptchaToken(captchaTokenSelector, Runtime);
        if (!isCaptchaPresent1) {
            throw new Error("CAPTCHA response token not found.");
        }

        // Take a screenshot
        console.log('Taking screenshot...');
        const screenshot2 = await Page.captureScreenshot({ format: 'png', fromSurface: true });
        const buffer2 = Buffer.from(screenshot2.data, 'base64');
        fs.writeFileSync('fullpage_screenshot3.png', buffer2);
        console.log('Screenshot taken');

        
        // Click the signup button
        await Runtime.evaluate({
            expression: `document.querySelector("input#signup_button").click();`
        });

        await Page.loadEventFired(); // Wait for the page to load
        await sleep(5000); // Wait 5 seconds

        // Disable the lottery by clicking the checkbox
        await Runtime.evaluate({
            expression: `document.querySelector("input#disable_lottery_checkbox").click();`
        });
        await sleep(2000); // Wait 5 seconds
        console.log("Signup succeeded.");

    } catch (error) {
        throw new Error("Automation failed:", error.message);

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
                throw new Error(`Error closing CloudFreed instance: ${closeError.message}`);
            }
        }
    }
}

async function performAutomationWithRetry(retries = 5) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await performAutomation();
            console.log(`Automation succeeded on attempt ${attempt}.`);
            break; // Exit loop if the function succeeds
        } catch (error) {
            console.error(`Automation failed on attempt ${attempt}:`, error.message);
            if (attempt === retries) {
                console.error("All retry attempts failed.");
            } else {
                await sleep(5000);
                console.log(`Retrying... (${attempt + 1}/${retries})`);
            }
        }
    }
}

// Execute the automation process with retry
(async () => {
    await performAutomationWithRetry();
})();
