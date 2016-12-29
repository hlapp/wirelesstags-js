"use strict";

var util = require('util');
var APICallError = require('./APICallError');

function TagManagerTimedOutError(msg, apiCall) {
    APICallError.call(this, msg, apiCall);
    this.name = this.constructor.name;
}
util.inherits(TagManagerTimedOutError, APICallError);

module.exports = TagManagerTimedOutError;
