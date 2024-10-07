# FreeBitcoin Automation Tool

This tool facilitates interaction with [FreeBitcoin](https://freebitco.in/?r=10175864), automating routine tasks such as login and button interactions using Node.js and Puppeteer.

## Features
- Automatic login using cookies.
- Roll button automation for FreeBitcoin.
- Integration with GitHub Actions for scheduled execution.

## Setup

1. Clone the repository:

    ```bash
    git clone https://github.com/libinpeter/btc.git
    cd btc
    ```

2. Install dependencies:

    ```bash
    npm install
    ```

3. Schedule automation using GitHub Actions:

   Configure GitHub Actions to automate processes by adding the necessary secrets (e.g., cookies) in the repository settings.

## Running the Automation

To run the tool locally:

```bash
node freebitco.js
