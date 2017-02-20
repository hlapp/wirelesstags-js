"use strict";

/* eslint-disable no-process-env, no-sync */

/**
 * The cloud platform interface to the Wireless Tag platform. This
 * module exports the constructor for the {@link WirelessTagPlatform}
 * class.
 *
 * See README for further documentation.
 *
 * @module wirelesstags
 */
var WirelessTagPlatform = require('./lib/platform');

const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * @const {string} - The name of the default configuration file in the
 *                   executing user's home directory.
 *                   Used by {@link WirelessTagPlatform.loadConfig}.
 * @default
 */
const CONFIG_NAME = ".wirelesstags";

/**
 * @const {string} - The environment variable containing the Wireless
 *                   Tag API user name.
 *                   Used by {@link WirelessTagPlatform.loadConfig}.
 * @default
 */
const ENV_USERNAME = "WIRELESSTAG_API_USER";

/**
 * @const {string} - The environment variable containing the Wireless
 *                   Tag API password.
 *                   Used by {@link WirelessTagPlatform.loadConfig}.
 * @default
 */
const ENV_PASSWORD = "WIRELESSTAG_API_PASSWORD";

const ENV_TOKEN = "WIRELESSTAG_API_TOKEN";

/**
 * Loads config information, which presently consists primarily of
 * connection options.
 *
 * The algorithm will attempt to read the file [CONFIG_NAME]{@link
 * module:wirelesstags~CONFIG_NAME} (in JSON format) in the executing
 * user's home directory if the file exists. It will then take
 * username and password from the environment ([ENV_USERNAME]{@link
 * module:wirelesstags~ENV_USERNAME} and [ENV_PASSWORD]{@link
 * module:wirelesstags~ENV_PASSWORD}), which allows to use the
 * environment to override settings in the configuration file.
 *
 * @returns {Object}
 * @memberof WirelessTagPlatform
 */
WirelessTagPlatform.loadConfig = function() {
    let config = {};
    let confPath = path.join(os.homedir ? os.homedir() : process.env.HOME,
                             CONFIG_NAME);
    try {
        let confContent = fs.readFileSync(confPath, 'utf8');
        config = JSON.parse(confContent);
    } catch (err) {
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

/**
 * Creates a {@link WirelessTagPlatform} instance, using the given
 * options for initializing. In contrast to the constructor, this
 * method will first attempt to load default configuration using
 * {@link WirelessTagPlatform.loadConfig}.
 *
 * @param {Object} [options] - overrides options found in the default
 *   configuration loaded using {@link WirelessTagPlatform.loadConfig}.
 * @param {String} [options.log] - a custom log function.
 * @param {String} [options.errorHandler] - a function returning a custom
 *                       error handler, will be passed a callback function.
 * @param {String} [options.apiBaseURI] - the base URI of the API server
 *                        if hosted on a different server than the default
 *
 * @returns {WirelessTagPlatform}
 * @memberof WirelessTagPlatform
 */
WirelessTagPlatform.create = function(options) {
    let config = WirelessTagPlatform.loadConfig();
    for (let key in options) {
        config[key] = options[key];
    }
    return new WirelessTagPlatform(config);
};

/**
 * Callback accepted by most API-querying methods.
 *
 * @callback module:wirelesstags~apiCallback
 * @param {Error} error - the error instance if one occurred
 * @param {Object} [result] - the result if success
 * @param {Object} result.object - the object for which the value was returned
 * @param {} [result.value] - the value returned by the API-querying
 *            method; unless noted otherwise, this will be the same as
 *            what the Promise resolves to that the method returns,
 *            provided it is different from the object itself
 */

module.exports = WirelessTagPlatform;
