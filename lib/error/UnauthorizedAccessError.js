"use strict";

var util = require('util');
var APICallError = require('./APICallError');

function UnauthorizedAccessError(msg, apiCall) {
    APICallError.call(this, msg, apiCall);
    this.name = this.constructor.name;
}
util.inherits(UnauthorizedAccessError, APICallError);

module.exports = UnauthorizedAccessError;
