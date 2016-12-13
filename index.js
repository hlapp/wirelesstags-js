/*
 * See README.md
 */
"use strict";

/*
 * The cloud platform interface to the Wireless Tag platform
 */
var WirelessTagPlatform = require('./lib/platform.js');

const path = require('path');
const os = require('os');
const fs = require('fs');

const CONFIG_NAME = ".wirelesstags";
const ENV_USERNAME = "WIRELESSTAG_API_USER";
const ENV_PASSWORD = "WIRELESSTAG_API_PASSWORD";
const ENV_TOKEN = "WIRELESSTAG_API_TOKEN";

WirelessTagPlatform.loadConfig = function() {
    let config = {};
    let confPath = path.join(os.homedir ? os.homedir() : process.env.HOME,
                             CONFIG_NAME);
    try {
        let confContent = fs.readFileSync(confPath, 'utf8');
        config = JSON.parse(confContent);
    }
    catch (err) {
        if (err.code !== "ENOENT") throw err;
    }
    if (process.env[ENV_USERNAME]) {
        config.username = process.env[ENV_USERNAME];
    }
    if (process.env[ENV_PASSWORD]) {
        config.password = process.env[ENV_PASSWORD];
    }
    if (process.env[ENV_TOKEN]) {
        config.bearer = process.env[ENV_TOKEN];
    }
    return config;
};

WirelessTagPlatform.create = function(options) {
    let config = WirelessTagPlatform.loadConfig();
    for (let key in options) {
        config[key] = options[key];
    }
    return new WirelessTagPlatform(config);
};

module.exports = WirelessTagPlatform;
