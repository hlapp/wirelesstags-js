"use strict";

var util = require('util');
var APICallError = require('./APICallError');

function TagManagerOfflineError(msg, apiCall) {
    APICallError.call(this, msg, apiCall);
    this.name = this.constructor.name;
}
util.inherits(TagManagerOfflineError, APICallError);

module.exports = TagManagerOfflineError;
