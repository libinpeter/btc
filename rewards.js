const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

async function loadCookies(page, cookiesPath, base64Cookies) {
    if (!base64Cookies) {
        throw new Error("No base64Cookies provided and cookiesPath does not exist.");
    }
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

// Fetch reward points from the page
async function getRewardPoints(page) {
    return await page.evaluate(() => {
        return parseInt(document.querySelector('.user_reward_points').innerText.replace(',', ''), 10);
    });
}

// Redeem a specific bonus and check if successful by verifying point reduction
async function tryRedeemBonus(page, bonusType) {
    console.log(`Attempting to redeem bonus: ${bonusType}`);
    const originalPoints = await getRewardPoints(page);

    try {
        // Attempt to redeem the bonus
        await page.evaluate((bonusType) => {
            RedeemRPProduct(bonusType);
        }, bonusType);

        // Wait for 8 seconds before re-checking the points
        await new Promise(resolve => setTimeout(resolve, 8000));

        // Get the reward points again after 8 seconds
        const newPoints = await getRewardPoints(page);
        
        // Check if points reduced
        if (newPoints < originalPoints) {
            console.log(`Redemption successful: ${bonusType}`);
            console.log(`Original Points: ${originalPoints}, New Points: ${newPoints}`);
            return true; // Bonus successfully redeemed
        } else {
            console.log(`Redemption failed or not eligible for: ${bonusType}`);
            return false; // Move to the next bonus
        }
    } catch (error) {
        console.error(`Error redeeming bonus ${bonusType}: ${error.message}`);
        return false;
    }
}

// Main function to redeem the highest available bonus
async function redeemBonus(page) {
    const bonuses = ['fp_bonus_1000', 'fp_bonus_500', 'fp_bonus_100', 'fp_bonus_50'];
    for (let bonus of bonuses) {
        const success = await tryRedeemBonus(page, bonus);
        if (success) {
            // Log reward points after successful redemption
            let rewardPointsAfterRedeem = await getRewardPoints(page);
            console.log(`Reward Points after redeeming ${bonus}: ${rewardPointsAfterRedeem}`);
            return; // Exit the function as soon as a bonus is redeemed successfully
        }
    }
    console.log("No bonus redeemed. Lack of points or another issue.");
}

// Main function to redeem Wheel of Fortune
async function redeemWheelOfFortuneSpins(page) {
    console.log("Starting the process to redeem Wheel of Fortune spins...");

    // Step 1: Get available spins
    const maxSpins = await page.$eval('#rp_wof_max_tickets', el => el.innerText);
    console.log("Available Wheel of Fortune Spins:", maxSpins);

    // Step 2: Input the available spins into the input field
    await page.$eval('#rp_wof_tix_no', (input, maxSpins) => input.value = maxSpins, maxSpins);
    console.log(`Entered ${maxSpins} into the tickets input field.`);

    // Step 3: Click the exchange button
    await page.evaluate(() => RedeemRPProduct('exchange_wof'));
    console.log("Clicked the EXCHANGE button to redeem Wheel of Fortune spins.");

    // Step 4: Directly navigate to the Wheel of Fortune Premium page
    const wheelOfFortuneUrl = 'https://freebitco.in/static/html/wof/wof-premium.html';
    await page.goto(wheelOfFortuneUrl, { waitUntil: 'networkidle2' });
    console.log("Navigated to the Wheel of Fortune Premium page.");

    // Step 5: Click the "PLAY ALL" button using a CSS selector
    await page.waitForSelector(".play-but");
    const playAllButton = await page.$(".play-but");

    if (playAllButton) {
        await playAllButton.click();
        console.log("Clicked 'PLAY ALL' to redeem all spins.");

        // Step 6: Wait for 10 seconds after spins
        await new Promise(resolve => setTimeout(resolve, 10000));
        console.log("Waited 10 seconds after redeeming spins.");
    } else {
        console.log("The 'PLAY ALL' button was not found.");
    }
}

(async () => {
    const maxFailures = 3;
    let failureCount = 0;

    const getRewards = async () => {
        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized']
            });
            const page = await browser.newPage();
            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.110 Safari/537.36'
            );

            await page.goto('https://freebitco.in', { waitUntil: 'networkidle2' });

            const cookiesPath = path.resolve('user_cookies.json');
            const base64Cookies = process.env.USER_COOKIES_BASE64 || '';
            if (base64Cookies) {
                await loadCookies(page, cookiesPath, base64Cookies);
                await page.reload({ waitUntil: 'networkidle2' });
                console.log("Page reloaded with cookies.");
            }

            // Redeem bonus
            await redeemBonus(page);

            // Redeem Wheel of Fortune spins in one function
            await redeemWheelOfFortuneSpins(page);

        } catch (error) {
            throw error;
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    };

    while (failureCount < maxFailures) {
        try {
            await getRewards();
            break; // Exit the loop on success
        } catch (error) {
            failureCount++;
            console.error(`Critical error: ${error}. Restarting rewards (${failureCount}/${maxFailures})...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
})();
