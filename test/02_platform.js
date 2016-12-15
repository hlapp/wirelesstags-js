"use strict";

/*
 * Test functions of the platform object
 */

describe('WirelessTagPlatform:', function() {

    var WirelessTagManager,
        WirelessTagPlatform,
        platform;
    var tagManagers = [];
    var credentialsMissing = false;

    before('load platform module', function() {
        WirelessTagPlatform = require('../');
        WirelessTagManager = require('../lib/tagmanager.js');
        platform = WirelessTagPlatform.create();
    });

    describe('#isConnected()', function() {
        let connected;

        it('should promise connection status', function() {
            return expect(platform.isConnected()).to.eventually.be.a('boolean').
                then((status) => { connected = status; });
        });
        it('should promise false initially', function() {
            return expect(connected).to.be.false;
        });
    });

    describe('#connect()', function() {
        let connectSpy = sinon.spy();
        
        it('should promise to connect platform to cloud API', function() {
            let connOpts = WirelessTagPlatform.loadConfig();

            if (! ((connOpts.username && connOpts.password)
                   || connOpts.bearer)) {
                // skip this if we don't have authentication information
                credentialsMissing = true;
                return this.skip();
            }

            platform.on('connect', connectSpy);
            return expect(platform.connect(connOpts)).to.
                eventually.equal(platform);
        });
        it('should emit "connect" event upon connection', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(connectSpy).to.have.been.calledWith(platform);
        });
        it('should make isConnected() promise true', function() {
            return expect(platform.isConnected()).to.eventually.be.true;
        });
    });

    describe('#discoverTagManagers()', function() {
        let discoverSpy = sinon.spy();
        
        it('should promise an array of tag managers', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            platform.on('discover', discoverSpy);
            return expect(platform.discoverTagManagers()).to.be.fulfilled;
        });
        it('should emit "discover" event for each tag manager', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(discoverSpy).to.have.always.been.calledWith(
                sinon.match.instanceOf(WirelessTagManager));
        });
    });

});
