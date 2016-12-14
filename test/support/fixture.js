"use strict";

/*
 * Test fixture of common setup and other functions
 */

var chai = require('chai');

chai.use(require('chai-as-promised'));
chai.use(require('sinon-chai'));

global.expect = chai.expect;
global.sinon = require('sinon');
