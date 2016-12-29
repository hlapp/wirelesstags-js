"use strict";

var util = require('util');
var APICallError = require('./APICallError');

function TagDidNotRespondError(msg, apiCall) {
    APICallError.call(this, msg, apiCall);
    this.name = this.constructor.name;
}
util.inherits(TagDidNotRespondError, APICallError);

module.exports = TagDidNotRespondError;
