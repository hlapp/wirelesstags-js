"use strict";

var util = require('util');
var APICallError = require('./APICallError');

function InvalidOperationError(msg, apiCall) {
    APICallError.call(this, msg, apiCall);
    this.name = this.constructor.name;
}
util.inherits(InvalidOperationError, APICallError);

module.exports = InvalidOperationError;
