"use strict";

/*
 * Test fixture of common setup and other functions
 */

var chai = require('chai');
var pAny = require('p-any');
var pLimit = require('p-limit');

chai.use(require('chai-as-promised'));
chai.use(require('sinon-chai'));

global.expect = chai.expect;
global.sinon = require('sinon');

Promise.any = pAny;
Promise.limit = pLimit;
Promise.AggregateError = pAny.AggregateError;
