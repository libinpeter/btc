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

(async () => {
  const maxFailures = 2;
  let failureCount = 0;

  const startGame = async () => {
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

      const navigateToGamePage = async (page) => {
        let retries = 0;
        const maxRetries = 3;
        while (retries < maxRetries) {
          try {
            await page.goto('https://freebitco.in', { waitUntil: 'networkidle2' });
            const cookiesPath = path.resolve('user_cookies.json');
            const base64Cookies = process.env.USER_COOKIES_BASE64 || '';
            if (base64Cookies) {
              await loadCookies(page, cookiesPath, base64Cookies);
              await page.reload({ waitUntil: 'networkidle2' });
              console.log("Page reloaded with cookies.");
            }
            await page.waitForSelector('.double_your_btc_link', { visible: true });
            await page.click('.double_your_btc_link');
            await page.evaluate(() => {
                const betInput = document.querySelector('#double_your_btc_stake');
                if (betInput) {
                  betInput.scrollIntoView();
                }
            });
            return;
          } catch (error) {
            retries++;
            console.log(`Error loading page. Retrying (${retries}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retries)));
          }
        }
        throw new Error("Failed to load the page after multiple retries.");
      };

      await navigateToGamePage(page);

      const betPercentage = 0.05; // 5% of current balance as the bet
      const maxBets = 100;
      const maxProfit = 0.0001; // Adjust as needed
      const minBalanceThreshold = 0.0000001;
      const maxBet = 0.00001; // Adjust as needed
      let betCount = 0;
      let totalWagered = 0;
      let gameRunning = true;
      let startingBalance = 0;
      let currentBet = 0;

      let retryCount = 0;
      const maxRetries = 3;

      function getRandomBoolean() {
        return Math.random() < 0.5;
      }

      async function getCurrentBalance() {
        const balance = await page.evaluate(() => {
          const balanceElement = document.getElementById('balance');
          return balanceElement ? parseFloat(balanceElement.innerText) : 0;
        });
        return balance;
      }

      async function placeBet(betAmount, isHigh = true) {
        try {
          await page.click('#double_your_btc_stake', { clickCount: 3 });
          await page.keyboard.press('Backspace');
          await page.type('#double_your_btc_stake', betAmount.toFixed(8));

          if (isHigh) {
            await page.click('#double_your_btc_bet_hi_button');
          } else {
            await page.click('#double_your_btc_bet_lo_button');
          }
          await page.waitForSelector('#double_your_btc_bet_win, #double_your_btc_bet_lose', { timeout: 10000 });
          retryCount = 0;
        } catch (error) {
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`Retrying bet placement (${retryCount}/${maxRetries})...`);
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
            await placeBet(betAmount, isHigh);
          } else {
            console.log("Max retries reached. Stopping game.");
            gameRunning = false;
          }
        }
      }

      function calculateNextBet(balance) {
        let bet = balance * betPercentage;
        if (bet > maxBet) {
          bet = maxBet;
        }
        return bet;
      }

      function checkStopConditions(balance, profit, betCount) {
        if (balance <= minBalanceThreshold) {
          console.log("Stopping: Balance fell below minimum threshold.");
          return true;
        }
        if (profit >= maxProfit) {
          console.log("Stopping: Max profit reached.");
          return true;
        }
        if (betCount >= maxBets) {
          console.log("Stopping: Max bet count reached.");
          return true;
        }
        return false;
      }

      async function handleResult() {
        let retry = 0;
        const maxRetries = 3;
        while (retry < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const result = await page.evaluate(() => {
            const winElement = document.getElementById('double_your_btc_bet_win');
            const loseElement = document.getElementById('double_your_btc_bet_lose');
            if (winElement && winElement.innerText.toLowerCase().includes('win')) {
              return true;
            } else if (loseElement && loseElement.innerText.toLowerCase().includes('lose')) {
              return false;
            }
            return null;
          });
          if (result !== null) {
            return result;
          }
          retry++;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        throw new Error("Unable to determine bet result after retries.");
      }

      startingBalance = await getCurrentBalance();
      console.log(`Starting balance: ${startingBalance.toFixed(8)} BTC`);
      currentBet = calculateNextBet(startingBalance);

      while (gameRunning) {
        const balance = await getCurrentBalance();
        const profit = balance - startingBalance;

        if (checkStopConditions(balance, profit, betCount)) {
          console.log("Stopping: Stop conditions met.");
          console.log(`Closing balance: ${balance.toFixed(8)} BTC`);
          console.log(`Net profit/loss: ${profit.toFixed(8)} BTC`);
          console.log(`Game ended. Total wagered: ${totalWagered.toFixed(8)} BTC`);  // Log total wagered here
          break;
        }

        const isHigh = getRandomBoolean();
        await placeBet(currentBet, isHigh);
        const win = await handleResult();

        // Add current bet amount to total wagered before updating
        totalWagered += currentBet;

        if (win) {
          console.log(`Win!! Bet: ${currentBet.toFixed(8)} BTC | Choice: ${isHigh ? 'High' : 'Low'}`);
        } else {
          console.log(`Loss! Bet: ${currentBet.toFixed(8)} BTC | Choice: ${isHigh ? 'High' : 'Low'}`);
        }

        // Introduce random delay to mimic human-like behavior
        const delay = Math.floor(Math.random() * (5000 - 1000 + 1)) + 1000; // 1-5 seconds delay
        await new Promise(resolve => setTimeout(resolve, delay));

        // Update current bet based on the latest balance
        currentBet = calculateNextBet(balance);

        betCount++;
      }

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
      await startGame();
      break;
    } catch (error) {
      failureCount++;
      console.error(`Critical error: ${error}. Restarting game (${failureCount}/${maxFailures})...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

})();
