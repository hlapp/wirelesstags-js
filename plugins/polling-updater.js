"use strict";

var request = require('request'),
    soap = require('soap');

const WSDL_URL_PATH = "/ethComet.asmx?WSDL";
const API_BASE_URI = "https://www.mytaglist.com";
const UPDATE_LOOP_WAIT = 1000;

function PollingTagUpdater(platform, config) {
    this.tagsByUUID = {};
    this.options = Object.assign({}, config);
    if (! this.options.wsdl_url) {
        let apiBaseURI;
        if (platform) apiBaseURI = platform.apiBaseURI;
        if (config && config.apiBaseURI) apiBaseURI = config.apiBaseURI;
        if (! apiBaseURI) apiBaseURI = API_BASE_URI;
        this.options.wsdl_url = apiBaseURI + WSDL_URL_PATH;
    }
}

PollingTagUpdater.prototype.addTags = function(tags) {
    if (tags && !Array.isArray(tags)) tags = [tags];
    for (let tag of tags) {
        this.tagsByUUID[tag.uuid] = tag;
    }
    return this;
};

PollingTagUpdater.prototype.removeTags = function(tags) {
    if (tags && !Array.isArray(tags)) tags = [tags];
    for (let tag of tags) {
        delete this.tagsByUUID[tag.uuid];
    }
    return this;
};

PollingTagUpdater.prototype.startUpdateLoop = function(waitTime) {
    if (waitTime === undefined) waitTime = UPDATE_LOOP_WAIT;
    if (this._updateTimer) return this._updateTimer;
    this._updateTimer = true; // placeholder to avoid race conditions
    let action = () => {
        this._updateTimer = true; // timer is done but action not yet
        this.apiClient().then((client) => {
            return pollForNextUpdate(client);
        }).then((tagDataList) => {
            tagDataList.forEach((tagData) => {
                this.updateTagFrom(tagData);
            });
            // reset wait time upon success
            waitTime = undefined;
        }).catch((err) => {
            console.error(err.stack ? err.stack : err);
            waitTime = waitTime * 2;
        }).then(() => {
            // with the preceding catch() this is in essence a finally()
            if (this._updateTimer) {
                this._updateTimer = null;
                this.startUpdateLoop(waitTime);
            }
            // otherwise we have been cancelled while running the update
        });
    };
    // ensure that updates weren't cancelled since we entered here
    if (this._updateTimer === true) {
        this._updateTimer = setTimeout(action, waitTime);
    }
    return this._updateTimer;
};

PollingTagUpdater.prototype.stopUpdateLoop = function() {
    let timer = this._updateTimer;
    this._updateTimer = null;   // avoid race conditions
    if (timer && timer !== true) {
        clearTimeout(timer);
    }
};

PollingTagUpdater.prototype.bounceUpdateLoop = function() {
    return this;
};

PollingTagUpdater.prototype.updateTagFrom = function(tagData) {
    // identify tag
    let tag = this.tagsByUUID[tagData.uuid];
    // if not listed for receiving updates, we are done
    if (! tag) return;
    // check that this is the current tag manager
    if (tagData.mac && (tag.wirelessTagManager.mac !== tagData.mac)) {
        throw new Error("expected tag " + tag.uuid
                        + " to be with tag manager " + tag.mac
                        + " but is reported to be with " + tagData.mac);
    }
    // we don't currently have anything more to do for the extra properties
    // identifying the tag manager, so simply get rid of them
    ['managerName','mac','dbid','mirrors'].forEach((k) => {
        delete tagData[k];
    });
    // almost done
    tag.data = tagData;
};

PollingTagUpdater.prototype.apiClient = function() {
    if (this.client) return Promise.resolve(this.client);
    return createSoapClient(this.options).then((client) => {
        this.client = client;
        return client;
    });
};

function createSoapClient(opts) {
    let wsdl = opts && opts.wsdl ? opts.wsdl : WSDL_URL;
    let clientOpts = { request: request.defaults({ jar: true, gzip: true }) };
    return new Promise((resolve, reject) => {
        soap.createClient(wsdl, clientOpts, (err, client) => {
            if (err) return reject(err);
            resolve(client);
        });
    }); 
}

function pollForNextUpdate(client, tagManager) {
    return new Promise((resolve, reject) => {
        let methodName = tagManager ?
            "GetNextUpdateForAllManagersOnDB" :
            "GetNextUpdateForAllManagers";
        let soapMethod = client[methodName];
        let args = {};
        if (tagManager) args.dbid = tagManager.dbid;
        soapMethod(args, function(err, result) {
            if (err) return reject(err);
            let tagDataList = JSON.parse(result[methodName + "Result"]);
            resolve(tagDataList);
        });
    });
}

module.exports = PollingTagUpdater;
