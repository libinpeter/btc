# FreeBitcoin Automation Bot
 
This bot automates the login process for [FreeBitcoin](https://freebitco.in/?r=10175864) and clicks the roll button using Node.js and Puppeteer for browser automation. It requires CAPTCHA to be disabled for seamless operation. If you're interested, you can integrate a CAPTCHA solver to bypass the challenge and fully automate the process.

## Features
- Automatic login using cookie.
- Roll button automation for FreeBitcoin.
- GitHub Actions integration for automatic scheduling.

## Setup

1. Clone the repository:

```bash
git clone https://github.com/freebitco1/automation.git
cd automation
```

2. Install dependencies:

```bash
npm install
```

3. Automate using GitHub Actions:

You can set up GitHub Actions to automate the roll process. Add the required secrets (cookies) to the repository's settings for continuous automation.

## Running the Bot

To run the bot locally:

```bash
node freebitco-bot.js
```

To run it using GitHub Actions, ensure your workflow file is correctly configured.
