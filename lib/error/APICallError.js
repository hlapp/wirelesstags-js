"use strict";

var util = require('util');

function APICallError(msg, apiCallProps) {
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
    let apiCall = apiCallProps || {};
    this.apiStatusCode = apiCall.statusCode;
    this.requestBody = apiCall.requestBody;
    this.apiURL = apiCall.url;
    this.message =
        (msg ? msg + "\n" : "")
        + "Calling "
        + (this.apiURL ? this.apiURL : "WirelessTag API")
        + (this.requestBody ?
           " with body " + JSON.stringify(this.requestBody) : "")
        + " failed with status " + this.apiStatusCode;
}
util.inherits(APICallError, Error);

module.exports = APICallError;
