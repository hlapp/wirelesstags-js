"use strict";

var util = require('util');
var OperationIncompleteError = require('./OperationIncompleteError');

function RetryUnsuccessfulError(msg, object, opName, attempt) {
    OperationIncompleteError.call(this, msg, object, opName);
    this.name = this.constructor.name;
    if (attempt) {
        this.message = this.message.replace(
            " incomplete.",
            " inccomplete, despite retrying " + attempt + " times.");
    }
}
util.inherits(RetryUnsuccessfulError, OperationIncompleteError);

module.exports = RetryUnsuccessfulError;
