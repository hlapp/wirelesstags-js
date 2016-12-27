"use strict";

var util = require('util');
var APICallError = require('./APICallError.js');

function TagManagerTimedOutError(msg, apiCall) {
    APICallError.call(this, msg, apiCall);
    this.name = this.constructor.name;
}
util.inherits(TagManagerTimedOutError, APICallError);

module.exports = TagManagerTimedOutError;
