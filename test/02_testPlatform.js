"use strict";

/*
 * Test functions of the platform object
 */

describe('platform functions:', function() {

    var WirelessTagManager,
        platform;
    var tagManagers = [];

    before('load platform module', function() {
        platform = require('../').create();
        WirelessTagManager = require('../lib/tagmanager.js');
        this.credentialsMissing = function(pf) {
            return ! (pf.config
                      && ((pf.config.username && pf.config.password)
                          || pf.config.bearer));
        }
    });

    describe('#isConnected()', function() {
        let connected;

        it('should determine connection status', function() {
            return expect(platform.isConnected()).to.eventually.be.a('boolean').
                then((status) => { connected = status; });
        });
        it('should be false initially', function() {
            return expect(connected).to.be.false;
        });
    });

    describe('#connect()', function() {
        let connectSpy = sinon.spy();
        
        it('should connect to the cloud API', function() {
            // skip this if we don't have connection information
            if (this.credentialsMissing(platform)) return this.skip();

            platform.on('connect', connectSpy);
            return expect(platform.connect()).to.eventually.equal(platform);
        });
        it('should emit "connect" event upon connection', function() {
            // skip this if we don't have connection information
            if (this.credentialsMissing(platform)) return this.skip();

            expect(connectSpy).to.have.been.calledWith(platform);
        });
    });

    describe('#discoverTagManagers()', function() {
        let discoverSpy = sinon.spy();
        
        it('should look for tag managers', function() {
            // skip this if we don't have connection information
            if (this.credentialsMissing(platform)) return this.skip();

            platform.on('discover', discoverSpy);
            platform.on('discover', (manager) => {
                tagManagers.push(manager);
            }); 
            return expect(platform.discoverTagManagers()).to.be.fulfilled;
        });
        it('should emit "discover" event for each tag manager', function() {
            // skip this if we don't have connection information
            if (this.credentialsMissing(platform)) return this.skip();

            expect(discoverSpy).to.have.always.been.calledWith(
                sinon.match.instanceOf(WirelessTagManager));
        });
    });

});
