"use strict";

var util = require('util');
var APICallError = require('./APICallError.js');

function DuplicateEthCmdError(msg, apiCall) {
    APICallError.call(this, msg, apiCall);
    this.name = this.constructor.name;
}
util.inherits(DuplicateEthCmdError, Error);

module.exports = DuplicateEthCmdError;
